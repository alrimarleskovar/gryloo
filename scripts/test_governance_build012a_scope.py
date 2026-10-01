"""Adversarial checks for the single owner-approved BUILD-012A allowance."""
import pathlib
import unittest
from governance_build012a_scope import (BASE, REF, CREATE, MODIFY, EVIDENCE,
                                       REVIEWED_BYTES, validate_scope, mask_source, ACTION, STORE)
ROOT = pathlib.Path(__file__).resolve().parents[1]


class Build012AScope(unittest.TestCase):
    def setUp(self):
        self.changed = (CREATE | MODIFY) - {EVIDENCE}
        self.files = {path:(ROOT/path).read_bytes() for path in self.changed if (ROOT/path).is_file()}

    def test_complete_exact_scope_without_unearned_acceptance(self):
        self.assertEqual(validate_scope(BASE, REF, self.changed, self.files), [])
        self.assertEqual(len(CREATE), 29)
        self.assertEqual(len(MODIFY), 35)

    def test_wrong_baseline(self):
        self.assertTrue(validate_scope('0'*40, REF, self.changed, self.files))

    def test_other_branch_and_main_are_not_authorized(self):
        for ref in ('main', 'codex/build-012b', REF+'-extra'):
            self.assertTrue(validate_scope(BASE, ref, self.changed, self.files))

    def test_extra_protected_ux_directory_and_dependency_paths(self):
        for path in ('packages/reference-compiler/src/borrow.ts', 'apps/reference-dapp/src/app/globals.css',
                     'apps/reference-dapp/src/state/workflow-store.tsx', 'pnpm-lock.yaml', 'package.json',
                     'packages/reference-compiler/src/', 'scripts/governance_ux_scope.py'):
            self.assertTrue(validate_scope(BASE, REF, self.changed|{path}, self.files))

    def test_missing_required_implementation_path(self):
        self.assertTrue(validate_scope(BASE, REF, self.changed-{ACTION}, self.files))

    def test_reviewed_source_mutations_fail_closed(self):
        for path, mutation in (
            ('packages/action-registry/src/aave-v3-testnet.ts', ' // wrong Pool'),
            ('packages/action-registry/src/execution-capabilities.ts', ' // unrelated profile promotion'),
            (ACTION, "\nfetch('https://unapproved.example');"),
            (ACTION, "\nconst send = 'eth_sendRawTransaction';"),
            (STORE, "\nconst sign = 'eth_sign';"),
            ('packages/reference-compiler/src/supply.ts', '\n// unlimited approval'),
            ('packages/reference-reconciler/src/supply.ts', '\n// classify MOCKED as TESTNET_EXECUTED'),
            ('apps/reference-dapp/src/components/app-shell.tsx', '\n// unrelated production change'),
        ):
            files = dict(self.files)
            files[path] += mutation.encode()
            self.assertTrue(validate_scope(BASE, REF, self.changed, files), path)

    def test_privileged_source_mask_requires_exact_reviewed_bytes(self):
        source = self.files[ACTION].decode()
        self.assertNotIn('fetch(endpoint,', mask_source(ACTION, source, 'fetch'))
        tampered = source + '\n// unrelated edit'
        self.assertEqual(mask_source(ACTION, tampered, 'fetch'), tampered)
        self.assertEqual(mask_source('apps/reference-dapp/src/app/other-action.ts', source, 'fetch'), source)

    def test_acceptance_placeholder_or_mocked_evidence_is_rejected(self):
        for value in (b'{}', b'{"bundle":{"environment":"MOCKED","outcome":"RECONCILED"}}'):
            files = dict(self.files)
            files[EVIDENCE] = value
            self.assertTrue(validate_scope(BASE, REF, self.changed|{EVIDENCE}, files))

    def test_pins_cover_all_production_and_browser_changes(self):
        self.assertEqual(set(REVIEWED_BYTES), {p for p in CREATE|MODIFY if p.startswith(('apps/','packages/'))}|{'.github/workflows/contracts.yml'})


if __name__ == '__main__':
    unittest.main()
