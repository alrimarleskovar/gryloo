"""Acceptance and negative safety cases for owner-controlled governance."""

import json
import datetime
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from governance_lite import (AGE_WAIVER, CONTRACTS, GOVERNANCE, control_errors, secret_errors, validate,
                             dependency_age_waivers, dependency_release_age_allowed)

ROOT = Path(__file__).resolve().parents[1]


def safety_files():
    paths = [GOVERNANCE, CONTRACTS, "scripts/guarded-release-browser.mjs", "scripts/governance_lite.py", "scripts/test_governance_lite.py",
             "scripts/bootstrap-ci.py", "CLAUDE.md", "docs/SCOPE_GUARD.md", "package.json",
             "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc",
             "LICENSES/Apache-2.0.txt", "LICENSES/AGPL-3.0-only.txt"]
    if (ROOT / AGE_WAIVER).is_file():
        paths.append(AGE_WAIVER)
    return {path: (ROOT / path).read_text() for path in paths}


class GovernanceLite(unittest.TestCase):
    def setUp(self):
        self.files = safety_files()

    def assert_passes(self, files=None, branch="codex/future-product"):
        self.assertEqual(validate(files or self.files, branch), [])

    def test_a_normal_product_changes_without_path_manifest(self):
        for path in ("packages/reference-compiler/src/ir.ts", "apps/reference-dapp/src/server/service.ts",
                     "apps/reference-dapp/src/components/product.tsx"):
            self.files[path] = "export const changed = true;\n"
        self.assert_passes()

    def test_b_new_adapter_file_without_amendment(self):
        self.files["packages/action-registry/src/new-adapter.ts"] = "export const adapter = {};\n"
        self.assert_passes()

    def test_c_test_assertion_without_byte_update(self):
        path = "packages/reference-compiler/test/supply.test.ts"
        self.files[path] = "expect(amount).toEqual('100');\n"
        self.assert_passes()
        self.files[path] = "expect(amount).toEqual('101');\n"
        self.assert_passes()

    def test_d_single_shallow_commit_with_no_old_history_or_network(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            for path, body in self.files.items():
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(body)
            def git(*args):
                return subprocess.check_output(["git", "-C", scratch, *args], text=True, stderr=subprocess.DEVNULL)
            git("init", "-b", "codex/offline-product")
            git("add", ".")
            git("-c", "user.name=Governance test", "-c", "user.email=test@example.invalid",
                "-c", "commit.gpgsign=false", "commit", "-m", "Single current snapshot")
            (root / ".git/shallow").write_text(git("rev-parse", "HEAD"))
            self.assertEqual(git("rev-list", "--count", "HEAD").strip(), "1")
            env = {**os.environ, "GOVERNANCE_BRANCH": "codex/offline-product", "GOVERNANCE_EVENT": "local"}
            result = subprocess.run([sys.executable, "scripts/governance_lite.py"], cwd=root,
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            git("diff", "--check")
            git("show", "--format=", "--check", "HEAD")
            # The same entrypoint rejects a newly introduced secret and redacts it.
            value = "0x" + "913ad742e805bc6f" * 4
            (root / "new-product.ts").write_text("const privateKey = '" + value + "';\n")
            rejected = subprocess.run([sys.executable, "scripts/governance_lite.py"], cwd=root,
                                      env=env, capture_output=True, text=True)
            self.assertEqual(rejected.returncode, 1)
            self.assertIn("possible credential assignment", rejected.stderr)
            self.assertNotIn(value, rejected.stderr)

    def test_e_secret_families_fail_without_exposing_value(self):
        values = [
            "privateKey = '" + "0x" + "913ad742e805bc6f" * 4 + "'",
            "api_key = '" + "zQ7mP9vX2tK5nL8" * 2 + "'",
            "-----BEGIN " + "RSA PRIVATE KEY-----",
            "gh" + "p_" + "aB4cD7eF9" * 4,
            "AK" + "IA" + "9AB3CD5EF7GH2JK4",
            "xo" + "xb-" + "9876543210-abcd",
            "s" + "k-" + "aB4cD7eF9" * 3,
            "seed_phrase = '" + " ".join(["word" + letter for letter in "abcdefghijkl"]) + "'",
        ]
        for value in values:
            with self.subTest(value_index=values.index(value)):
                self.files["new-product.ts"] = value
                errors = validate(self.files, "codex/product")
                self.assertTrue(any("possible" in error for error in errors))
                self.assertFalse(any(value in error for error in errors))

    def test_documented_placeholders_and_generated_fixtures_pass(self):
        for value in ("YOUR_API_KEY_HERE", "REPLACE_ME_WITH_A_KEY", "EXAMPLE_NOT_A_CREDENTIAL", "<private-key>"):
            self.assertEqual(secret_errors(".env.example", "api_key = '" + value + "'"), [])
        self.files["packages/example/test/fixture.ts"] = "const privateKey = generateDisposableTestKey();\n"
        self.assert_passes()

    def test_f_deleted_or_commented_safety_command_fails(self):
        for command in ("python3 scripts/governance_lite.py",
                        "python3 -m unittest discover -s scripts -p 'test_governance_lite.py'"):
            for replacement in ("", "# " + command, "echo '" + command + "'", command + " || true"):
                files = dict(self.files)
                files[GOVERNANCE] = files[GOVERNANCE].replace(command, replacement)
                self.assertTrue(control_errors(files))

    def test_f_skipped_or_ignored_safety_step_fails(self):
        for condition in ("if: false", "if: failure()", "continue-on-error: true"):
            files = dict(self.files)
            files[GOVERNANCE] = files[GOVERNANCE].replace(
                "      - name: Governance-lite self-tests and safety check\n",
                "      - name: Governance-lite self-tests and safety check\n        " + condition + "\n")
            self.assertTrue(control_errors(files))
        files[GOVERNANCE] = self.files[GOVERNANCE].replace("set -euo pipefail", "set +e")
        self.assertTrue(control_errors(files))
        for bypass in ("exit 0", "set +e"):
            files[GOVERNANCE] = self.files[GOVERNANCE].replace(
                "          python3 scripts/governance_lite.py", "          " + bypass + "\n          python3 scripts/governance_lite.py")
            self.assertTrue(control_errors(files))

    def test_f_required_file_removal_fails(self):
        for path in (GOVERNANCE, CONTRACTS, "scripts/governance_lite.py", "scripts/test_governance_lite.py",
                     "CLAUDE.md", "docs/SCOPE_GUARD.md"):
            files = dict(self.files)
            del files[path]
            self.assertTrue(control_errors(files), path)

    def test_g_future_build012b_ir_adapter_dapp_and_tests(self):
        for path in ("packages/workflow-contracts/src/borrow-ir.ts", "packages/action-registry/src/aave-borrow.ts",
                     "apps/reference-dapp/src/server/borrow-service.ts", "apps/reference-dapp/src/state/borrow-store.tsx",
                     "apps/reference-dapp/e2e/borrow.spec.ts", "packages/reference-executor/test/borrow.test.ts"):
            self.files[path] = "// Legitimate product change subject to tests and owner review.\n"
        self.assert_passes(branch="codex/build-012b")

    def test_local_main_and_detached_branch_fail_but_post_merge_ci_passes(self):
        for branch in ("main", "master", "", "HEAD"):
            self.assertTrue(validate(self.files, branch))
        self.assertTrue(validate(self.files, "main", "pull_request"))
        self.assertEqual(validate(self.files, "main", "push"), [])

    def test_auto_merge_commands_fail(self):
        for command in (" ".join(("gh", "pr", "merge", "42")),
                        "enablePullRequestAuto" + "Merge", "curl /repos/example/pulls/42/" + "merge"):
            files = dict(self.files)
            files["scripts/merge.sh"] = command
            self.assertTrue(any("automated merge" in e for e in control_errors(files)))

    def test_ci_dependency_test_browser_and_evidence_gates_remain(self):
        for command in ("pnpm typecheck", "pnpm lint", "pnpm build", "pnpm schemas:check", "pnpm test",
                        "pnpm install --frozen-lockfile --ignore-scripts", "pnpm audit --audit-level low",
                        "python3 scripts/bootstrap-ci.py --verify-dependencies",
                        "node scripts/guarded-release-browser.mjs product",
                        "node scripts/guarded-release-browser.mjs composition"):
            files = dict(self.files)
            files[CONTRACTS] = files[CONTRACTS].replace("          " + command + "\n", "")
            self.assertTrue(control_errors(files), command)
        contracts = self.files[CONTRACTS]
        for marker in ("verifyTranscriptDocument", "verifyLiquidityTranscript", "verifyCompositionTranscript",
                       "pnpm sbom --sbom-format cyclonedx", "--lockfile-only"):
            self.assertIn(marker, contracts)
        browser = self.files["scripts/guarded-release-browser.mjs"]
        for marker in ("'playwright', 'test'", "release-provenance.spec.ts", "release-fork-provenance.spec.ts",
                       "release-composition-provenance.spec.ts", "release-financial-provenance.spec.ts",
                       "cow-recovery.spec.ts", "simulate-review-acceptance.spec.ts",
                       "execute-product-workspace.spec.ts", "if (result.status !== 0) process.exit"):
            self.assertIn(marker, browser)

    def test_privileged_workflows_fail(self):
        for before, after in (("contents: read", "contents: write"),
                              ("  pull_request:", "  pull_request" + "_target:"),
                              ("${{ github.token }}", "${{ secrets." + "WALLET_KEY }}")):
            files = dict(self.files)
            files[GOVERNANCE] = files[GOVERNANCE].replace(before, after)
            self.assertTrue(control_errors(files))

    def test_disabled_package_test_or_dependency_controls_fail(self):
        manifest = json.loads(self.files["package.json"])
        for command in ("echo green", "vitest run || true", "vitest run --passWithNoTests"):
            manifest["scripts"]["test"] = command
            files = dict(self.files)
            files["package.json"] = json.dumps(manifest)
            self.assertTrue(control_errors(files))
        for path, line in ((".npmrc", "ignore-scripts=true"), ("pnpm-workspace.yaml", "minimumReleaseAge: 10080")):
            files = dict(self.files)
            files[path] = files[path].replace(line, "")
            self.assertTrue(control_errors(files))

    def test_license_copy_mismatch_fails(self):
        self.files["packages/example/package.json"] = json.dumps({"license": "Apache-2.0"})
        self.files["packages/example/LICENSE"] = self.files["LICENSES/Apache-2.0.txt"]
        self.assert_passes()
        self.files["packages/example/LICENSE"] = "Wrong license\n"
        self.assertTrue(control_errors(self.files))

    def test_checkout_fetches_only_current_revision_and_immediate_parents(self):
        body = self.files[GOVERNANCE]
        fetches = [line.strip() for line in body.splitlines() if " fetch " in line]
        self.assertEqual(len(fetches), 1)
        self.assertTrue(fetches[0].endswith('fetch --depth=2 origin "$REVISION"'))
        self.assertNotIn("SCOPE_BASE", body)

    def test_exact_temporary_security_age_waiver(self):
        waivers, errors = dependency_age_waivers(self.files)
        self.assertEqual(errors, [])
        self.assertEqual(waivers, {("source-map-js", "1.2.2")})
        cutoff = datetime.datetime(2026, 9, 30, tzinfo=datetime.timezone.utc)
        young = cutoff + datetime.timedelta(days=1)
        for name, version, expected in (("source-map-js", "1.2.2", True),
                ("source-map-js", "1.2.1", False), ("source-map-js", "1.2.3", False),
                ("another-package", "1.2.2", False), ("sharp", "0.35.5", False)):
            with self.subTest(name=name, version=version):
                self.assertEqual(dependency_release_age_allowed(name, version, young, cutoff, waivers), expected)
        # The seven-day boundary remains inclusive, with no waiver for mature sharp.
        for name, version in (("sharp", "0.35.5"), ("another-package", "1.2.2")):
            self.assertTrue(dependency_release_age_allowed(name, version, cutoff, cutoff, waivers))
            self.assertFalse(dependency_release_age_allowed(name, version,
                cutoff + datetime.timedelta(microseconds=1), cutoff, waivers))

    def test_broad_or_undocumented_age_waivers_fail(self):
        for spec in ("source-map-js", "source-map-js@*", "source-map-js@>=1.2.2",
                     "source-map-js@1.2.1", "source-map-js@1.2.3", "sharp@0.35.5",
                     "source-map-js@1.2.2\n  - sharp@0.35.5"):
            files = dict(self.files)
            files["pnpm-workspace.yaml"] = files["pnpm-workspace.yaml"].replace("  - source-map-js@1.2.2", "  - " + spec)
            self.assertTrue(dependency_age_waivers(files)[1], spec)
        for field, value in (("temporary", False), ("approved_by", "Other"), ("version", "1.2.3")):
            files = dict(self.files)
            metadata = json.loads(files[AGE_WAIVER])
            metadata[field] = value
            files[AGE_WAIVER] = json.dumps(metadata)
            self.assertTrue(dependency_age_waivers(files)[1])
        files = dict(self.files)
        del files[AGE_WAIVER]
        self.assertTrue(dependency_age_waivers(files)[1])


if __name__ == "__main__":
    unittest.main()
