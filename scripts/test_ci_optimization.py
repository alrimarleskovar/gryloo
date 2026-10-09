"""Regression and adversarial tests for CI transport, cache and failure handling."""

from contextlib import redirect_stdout
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import tarfile
import unittest
from unittest.mock import patch
import zipfile

from ci_archive_cache import verified_archive

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bootstrap = load_script('bootstrap-ci')


class ArchiveCache(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.parent = Path(self.scratch.name)
        self.cache = self.parent / 'cache'
        self.env = patch.dict(os.environ, {'FLOFI_CI_ARCHIVE_CACHE': str(self.cache)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.data = b'public approved archive bytes'
        self.digest = hashlib.sha256(self.data).hexdigest()
        self.calls = 0

    def download(self, stream):
        self.calls += 1
        stream.write(self.data)

    def read(self, **kwargs):
        with verified_archive('test.tgz', self.parent, self.download, self.digest, **kwargs) as path:
            self.assertNotEqual(path, self.cache / 'test.tgz')
            self.assertEqual(path.read_bytes(), self.data)
            return path

    def test_cold_warm_and_invalidation(self):
        private = self.read()
        self.assertFalse(private.exists())
        self.assertEqual(self.calls, 1)
        self.read()
        self.assertEqual(self.calls, 1)
        self.data = b'new approved version'
        self.digest = hashlib.sha256(self.data).hexdigest()
        self.read()
        self.assertEqual(self.calls, 2)

    def test_same_size_corruption_is_reverified(self):
        self.read()
        (self.cache / 'test.tgz').write_bytes(b'x' * len(self.data))
        self.read(size=len(self.data))
        self.assertEqual(self.calls, 2)

    def test_cache_symlink_is_never_followed(self):
        self.cache.mkdir()
        foreign = self.parent / 'foreign'
        foreign.write_bytes(b'foreign private bytes')
        (self.cache / 'test.tgz').symlink_to(foreign)
        self.read()
        self.assertEqual(foreign.read_bytes(), b'foreign private bytes')
        self.assertFalse((self.cache / 'test.tgz').is_symlink())

    def test_fifo_and_directory_do_not_hang_or_get_recursively_removed(self):
        self.cache.mkdir()
        entry = self.cache / 'test.tgz'
        os.mkfifo(entry)
        self.read()
        entry.unlink()
        entry.mkdir()
        marker = entry / 'keep'
        marker.write_text('unrelated')
        with self.assertRaises(OSError):
            self.read()
        self.assertEqual(marker.read_text(), 'unrelated')

    def test_invalid_download_never_reaches_consumer_or_cache(self):
        self.digest = '0' * 64
        with self.assertRaises(RuntimeError):
            self.read()
        self.assertFalse((self.cache / 'test.tgz').exists())
        self.assertFalse(list(self.parent.glob('flofi-archive-*')))

    def test_size_pin_and_sha512_are_enforced(self):
        with self.assertRaises(RuntimeError):
            self.read(size=len(self.data) + 1)
        digest = hashlib.sha512(self.data).hexdigest()
        with verified_archive('pnpm.tgz', self.parent, self.download, digest, algorithm='sha512') as path:
            self.assertEqual(path.read_bytes(), self.data)

    def test_mutating_cache_after_verification_does_not_change_private_copy(self):
        self.read()
        with verified_archive('test.tgz', self.parent, self.download, self.digest) as path:
            (self.cache / 'test.tgz').write_bytes(b'poison')
            self.assertEqual(path.read_bytes(), self.data)

    def test_disabled_cache_downloads_and_checks_every_time(self):
        with patch.dict(os.environ):
            os.environ.pop('FLOFI_CI_ARCHIVE_CACHE')
            self.read()
            self.read()
        self.assertEqual(self.calls, 2)


class RegistryTransport(unittest.TestCase):
    def response(self, body, encoding='identity'):
        response = io.BytesIO(body)
        response.status = 200
        response.headers = {'Content-Encoding': encoding}
        return response

    def test_compressed_and_identity_responses_have_identical_bytes(self):
        data = b'{"versions":{},"time":{}}'
        for encoding, body in [('identity', data), ('gzip', gzip.compress(data))]:
            with patch.object(bootstrap.urllib.request, 'urlopen', return_value=self.response(body, encoding)) as fetch:
                self.assertEqual(bootstrap.fetch('https://registry.npmjs.org/example', compressed=True), data)
                self.assertEqual(fetch.call_args.args[0].get_header('Accept-encoding'), 'gzip')

    def test_bad_compression_and_unknown_encoding_fail_closed(self):
        for encoding in ['gzip', 'br']:
            with patch.object(bootstrap.urllib.request, 'urlopen', return_value=self.response(b'bad', encoding)):
                with self.assertRaises((RuntimeError, OSError)):
                    bootstrap.fetch('https://registry.npmjs.org/example', compressed=True)

    def test_multiple_versions_share_one_fresh_response_without_losing_fields(self):
        packages = {'1.0.0': {'license': 'MIT', 'dist': {'integrity': 'sha512-one'}},
                    '2.0.0': {'license': 'GPL-3.0-only', 'dist': {'integrity': 'sha512-two'}, 'cpu': ['arm64']}}
        metadata = {'versions': packages, 'time': {'1.0.0': '2020-01-01T00:00:00Z', '2.0.0': '2026-10-09T00:00:00Z'}}
        with patch.object(bootstrap, 'fetch', return_value=json.dumps(metadata).encode()) as fetch:
            locked = {'@scope/name@1.0.0': 'sha512-one', '@scope/name@2.0.0': 'sha512-two'}
            for _ in range(2):
                records = bootstrap.registry_metadata(locked)
                for version in packages:
                    self.assertEqual(records['@scope/name@' + version], (packages[version], metadata['time'][version], None))
            self.assertEqual(fetch.call_count, 2)  # no persistent or second-call metadata cache
            self.assertEqual(fetch.call_args.args[0], 'https://registry.npmjs.org/@scope%2fname')
            self.assertTrue(fetch.call_args.kwargs['compressed'])

    def test_unavailable_missing_version_missing_time_and_malformed_metadata_fail(self):
        for response in [b'not-json', b'{}', b'{"versions":{"1":{}},"time":{}}']:
            with patch.object(bootstrap, 'fetch', return_value=response):
                records = bootstrap.registry_metadata({'example@1': 'sha512-x'})
                self.assertIsNotNone(records['example@1'][2])
        with patch.object(bootstrap, 'fetch', side_effect=OSError('offline')):
            self.assertIsNotNone(bootstrap.registry_metadata({'example@1': 'sha512-x'})['example@1'][2])


class BootstrapIntegration(unittest.TestCase):
    def test_anvil_and_browser_cold_and_warm_keep_extraction_and_version_checks(self):
        for name in ['bootstrap-anvil', 'bootstrap-playwright']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as scratch:
                module = load_script(name)
                parent = Path(scratch)
                raw = io.BytesIO()
                binary = b'fixture executable bytes'
                if name == 'bootstrap-anvil':
                    with tarfile.open(fileobj=raw, mode='w:gz') as archive:
                        entry = tarfile.TarInfo('anvil')
                        entry.size = len(binary)
                        archive.addfile(entry, io.BytesIO(binary))
                    patches = {'ENTRIES': {'anvil': len(binary)}, 'ANVIL_SIZE': len(binary),
                               'ANVIL_SHA256': hashlib.sha256(binary).hexdigest()}
                    destination = module.DESTINATION_NAME
                    version = module.ANVIL_VERSION
                else:
                    with zipfile.ZipFile(raw, 'w') as archive:
                        archive.writestr(module.EXECUTABLE, binary)
                    patches = {'ENTRY_COUNT': 1}
                    destination = 'chromium_headless_shell-' + module.REVISION
                    version = 'Google Chrome for Testing ' + module.BROWSER_VERSION
                data = raw.getvalue()
                patches.update(SIZE=len(data), SHA256=hashlib.sha256(data).hexdigest())
                downloads = []

                def build_opener(_proxy, redirect):
                    class Opener:
                        def open(self, source, timeout):
                            downloads.append(source)
                            redirect.redirects = 1
                            response = io.BytesIO(data)
                            response.status = 200
                            response.url = module.FINAL if name.endswith('playwright') else 'https://' + module.FINAL_HOST + module.FINAL_PATH
                            return response
                    return Opener()

                with patch.dict(os.environ, {'FLOFI_CI_ARCHIVE_CACHE': str(parent / 'cache')}), patch.multiple(module, **patches), patch.object(module.urllib.request, 'build_opener', side_effect=build_opener), patch.object(module.subprocess, 'check_output', return_value=version) as execute, redirect_stdout(io.StringIO()):
                    for run in ['cold', 'warm']:
                        target = parent / run / destination
                        module.bootstrap(target)
                        executable = target / ('anvil' if name.endswith('anvil') else module.EXECUTABLE)
                        self.assertEqual(executable.read_bytes(), binary)
                        self.assertEqual(executable.stat().st_mode & 0o777, 0o755)
                    self.assertEqual(len(downloads), 1)
                    self.assertEqual(execute.call_count, 2)
                    # Both poisoned cache and bad upstream bytes fail before execution.
                    (parent / 'cache' / module.ARCHIVE).write_bytes(b'bad')
                    module.SHA256 = '0' * 64
                    with self.assertRaises(RuntimeError):
                        module.bootstrap(parent / 'bad' / destination)
                    self.assertEqual(execute.call_count, 2)
                    self.assertFalse((parent / 'bad' / destination).exists())


class FullDependencyGate(unittest.TestCase):
    """The whole existing gate runs on a synthetic registry; corruptions must fail."""
    def setUp(self):
        lock = (ROOT / 'pnpm-lock.yaml').read_text().split('\npackages:\n')[1].split('\nsnapshots:\n')[0]
        blocks = re.split(r'(?m)^  (\S[^\n]*):\n', lock)
        self.registry = {}
        for identity, body in zip(blocks[1::2], blocks[2::2]):
            identity = identity.strip("'")
            integrity = re.search(r'integrity: (sha512-[A-Za-z0-9+/=]+)', body).group(1)
            name, version = identity.rsplit('@', 1)
            package = {'license': 'MIT', 'dist': {'integrity': integrity}}
            if identity in bootstrap.BUILD002_REVIEWED_LICENSE_EXCEPTIONS:
                approved = bootstrap.BUILD002_REVIEWED_LICENSE_EXCEPTIONS[identity]
                package.update({key: approved[key] for key in ['license', 'os', 'cpu', 'libc']})
            document = self.registry.setdefault(name, {'versions': {}, 'time': {}})
            document['versions'][version] = package
            document['time'][version] = '2020-01-01T00:00:00Z'
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)

    def verify(self):
        def fetch(url, **_):
            return json.dumps(self.registry[url.removeprefix('https://registry.npmjs.org/').replace('%2f', '/')]).encode()
        with patch.dict(os.environ, {'RUNNER_TEMP': self.scratch.name}), patch.object(bootstrap, 'fetch', side_effect=fetch), redirect_stdout(io.StringIO()):
            bootstrap.verify_dependencies()

    def test_full_inventory_and_existing_exceptions_pass(self):
        self.verify()
        evidence = json.loads((Path(self.scratch.name) / 'build-002-dependencies.json').read_text())
        self.assertEqual(len(evidence), 265)

    def test_integrity_license_age_platform_and_missing_entry_fail_without_evidence(self):
        mutations = ['integrity', 'license', 'age', 'platform', 'missing']
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                saved = json.loads(json.dumps(self.registry))
                document = self.registry['@img/sharp-win32-x64']
                package = document['versions']['0.35.5']
                if mutation == 'integrity': package['dist']['integrity'] = 'sha512-poison'
                elif mutation == 'license': package['license'] = 'MIT'
                elif mutation == 'age': document['time']['0.35.5'] = '2999-01-01T00:00:00Z'
                elif mutation == 'platform': package['cpu'] = ['arm64']
                else: document['versions'].clear()
                with self.assertRaises(RuntimeError):
                    self.verify()
                self.assertFalse((Path(self.scratch.name) / 'build-002-dependencies.json').exists())
                self.registry = saved


class WorkflowInvariants(unittest.TestCase):
    def test_concurrency_is_pr_only_and_workflow_specific(self):
        keys = []
        for workflow in ['contracts', 'governance']:
            body = (ROOT / '.github/workflows' / (workflow + '.yml')).read_text()
            key = re.search(r'^  group: (.+)$', body, re.M).group(1)
            self.assertEqual(key, 'build-ci-' + workflow + '-${{ github.event_name }}-${{ github.event.pull_request.number || github.run_id }}')
            self.assertIn("  cancel-in-progress: ${{ github.event_name == 'pull_request' }}", body)
            def render(event, pr, run):
                return key.replace('${{ github.event_name }}', event).replace('${{ github.event.pull_request.number || github.run_id }}', str(pr or run))
            self.assertEqual(render('pull_request', 71, 100), render('pull_request', 71, 101))
            self.assertNotEqual(render('pull_request', 71, 100), render('pull_request', 72, 101))
            self.assertNotEqual(render('push', None, 100), render('push', None, 101))
            self.assertNotEqual(render('push', None, 100), render('pull_request', 100, 101))
            keys.append(render('pull_request', 71, 100))
        self.assertEqual(len(set(keys)), 2)

    def test_no_build_cache_or_worker_increase(self):
        body = (ROOT / '.github/workflows/contracts.yml').read_text()
        self.assertNotIn('restore-keys:', body)
        self.assertNotIn('save-always:', body)
        self.assertIn('actions/cache@caa296126883cff596d87d8935842f9db880ef25', body)
        self.assertIn("'scripts/bootstrap-*.py', 'scripts/ci_archive_cache.py', 'pnpm-lock.yaml', '.npmrc', 'pnpm-workspace.yaml'", body)
        paths = body.split('          path: |\n')[1].split('          #')[0]
        self.assertEqual(len(paths.splitlines()), 4)
        self.assertNotRegex(paths, r'node_modules|\.next|\.turbo|journal|runtime|keys')
        self.assertEqual(json.loads((ROOT / 'turbo.json').read_text())['concurrency'], '2')
        self.assertIn('workers: 1,', (ROOT / 'apps/reference-dapp/playwright.config.ts').read_text())

    def test_all_extra_mandatory_suites_and_security_steps_are_unconditional(self):
        body = (ROOT / '.github/workflows/contracts.yml').read_text()
        for command in ['pnpm test:postgres', 'pnpm exec eslint scripts/guarded-release-browser.mjs',
                        'pnpm sbom --sbom-format cyclonedx', 'pnpm exec vitest run packages/reference-compiler/test/composition.fork.test.ts',
                        'playwright test developer-journey.spec.ts', 'playwright test mcp-in-chat.spec.ts mcp-route-presentation.spec.ts',
                        'playwright test channel-signing.spec.ts',
                        'playwright test whatsapp-approve.spec.ts telegram-approve.spec.ts']:
            steps = [step for step in re.split(r'(?m)^      - name:', body) if command in step]
            self.assertEqual(len(steps), 1, command)
            self.assertNotRegex(steps[0], r'(?m)^\s*(if|continue-on-error):')
            self.assertIn('          set -euo pipefail\n', steps[0])


class StageReporting(unittest.TestCase):
    def test_real_failing_test_remains_failed_and_later_command_does_not_run(self):
        with tempfile.TemporaryDirectory() as scratch:
            env = {**os.environ, 'RUNNER_TEMP': scratch}
            command = "set -euo pipefail\nsource scripts/ci-observe.sh 'failing test'\npython3 -c 'assert False'\ntouch \"$RUNNER_TEMP/false-success\""
            result = subprocess.run(['bash', '-c', command], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertFalse((Path(scratch) / 'false-success').exists())
            row = json.loads(next((Path(scratch) / 'flofi-ci-metrics').glob('*.json')).read_text())
            self.assertEqual(row['outcome'], 'failure')
            self.assertIn('duration', row)

    def test_success_and_cancelled_outcomes_remain_distinct(self):
        for command, status, outcome in [('true', 0, 'success'), ('kill -TERM $$', 143, 'cancelled/interrupted')]:
            with tempfile.TemporaryDirectory() as scratch:
                env = {**os.environ, 'RUNNER_TEMP': scratch, 'GITHUB_STEP_SUMMARY': scratch + '/summary'}
                result = subprocess.run(['bash', '-c', "set -euo pipefail\nsource scripts/ci-observe.sh 'stage'\n" + command], cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, status)
                summary = subprocess.run(['python3', 'scripts/ci-observe.py', 'summary'], cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(summary.returncode, 0, summary.stderr)
                self.assertIn(outcome, (Path(scratch) / 'summary').read_text())

    def test_cleanup_only_runs_the_owned_hook_and_preserves_failure(self):
        with tempfile.TemporaryDirectory() as scratch:
            env = {**os.environ, 'RUNNER_TEMP': scratch}
            command = "set -euo pipefail\nsource scripts/ci-observe.sh 'cleanup'\nflofi_ci_cleanup() { touch \"$RUNNER_TEMP/owned-cleanup\"; }\nexit 17"
            result = subprocess.run(['bash', '-c', command], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 17)
            self.assertTrue((Path(scratch) / 'owned-cleanup').exists())


if __name__ == '__main__':
    unittest.main()
