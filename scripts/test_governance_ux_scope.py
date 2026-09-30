import ast
import hashlib
import textwrap
import unittest
from pathlib import Path

from governance_ux_scope import low_risk_path, low_risk_source


PREFIX = "apps/reference-dapp/"
WORKFLOW_STORE = PREFIX + "src/state/workflow-store.tsx"
WORKFLOW_SOURCE = (Path(__file__).resolve().parents[1] / WORKFLOW_STORE).read_text()
SIMULATE_SPEC = PREFIX + "e2e/mock-artifact-chain.spec.ts"
SIMULATE_SOURCE = (Path(__file__).resolve().parents[1] / SIMULATE_SPEC).read_text()
BASE_OBSERVATION_SPEC = PREFIX + "e2e/base-observation.spec.ts"
BASE_OBSERVATION_SOURCE = (Path(__file__).resolve().parents[1] / BASE_OBSERVATION_SPEC).read_text()


class ScopeTests(unittest.TestCase):
    def test_ordinary_ux_categories(self):
        allowed = (
            "src/app/globals.css",
            "src/app/layout.tsx",
            "public/gryloo-logo.png",
            "src/components/workflow-canvas.tsx",
            "src/components/toolbar-icons.tsx",
            "src/components/simulate-panel.tsx",
            "e2e/canvas-ux.spec.ts",
            "e2e/canvas-ux.spec.ts-snapshots/build-chromium-linux.png",
            "e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png",
            "src/domain/editor-history.ts",
            "src/domain/canvas-keyboard.test.ts",
            "src/state/workflow-store.tsx",
        )
        for path in allowed:
            with self.subTest(path=path):
                self.assertTrue(low_risk_path(PREFIX + path))

    def test_sensitive_paths_fail_closed(self):
        blocked = (
            "src/wallet/eip1193.ts",
            "src/server/base-rpc.ts",
            "src/app/public-testnet-action.ts",
            "src/domain/protocol-adapter.ts",
            "src/domain/execution-authority.ts",
            "src/state/capability-store.tsx",
            "src/state/mode-a-store.tsx",
            "src/domain/evidence-promotion.ts",
            "src/components/execution-panel.tsx",
            "e2e/public-testnet.spec.ts",
            "e2e/fork/recording-proxy.mjs",
            "public/network-config.ts",
        )
        for path in blocked:
            with self.subTest(path=path):
                self.assertFalse(low_risk_path(PREFIX + path))
        for path in ("packages/action-registry/src/capabilities.ts", ".github/workflows/governance.yml", "scripts/governance_ux_scope.py"):
            with self.subTest(path=path):
                self.assertFalse(low_risk_path(path))

    def test_privileged_code_cannot_enter_ux_source(self):
        path = PREFIX + "src/components/workflow-canvas.tsx"
        for added in ("fetch(url)", "provider.request({ method: 'eth_sendTransaction' })", "import { sign } from '../wallet/eip1193';", "'use server'", "TESTNET_EXECUTED"):
            with self.subTest(added=added):
                self.assertFalse(low_risk_source(path, added))
        self.assertTrue(low_risk_source(path, "const selected = [...selectedIds];"))
        self.assertFalse(low_risk_source(path, "", "if (!checkChainAccess(chain, workflow).ok) return;"))

    def test_workflow_store_editor_history_and_duplicate(self):
        history = WORKFLOW_SOURCE.replace(
            "  const redo = useCallback(() => dispatchHistory({ type: 'REDO' }), []);",
            "  const redo = useCallback(() => dispatchHistory({ type: 'REDO' }), []);\n"
            "  const selectHistory = useCallback(() => dispatchHistory({ type: 'UNDO' }), []);",
        )
        duplicate = history.replace(
            "  pending: Pending | null;",
            "  duplicateCanvasNodes(ids: readonly string[]): void;\n  pending: Pending | null;",
        ).replace(
            "  const [pending, setPending]",
            "  const duplicateCanvasNodes = useCallback((ids: readonly string[]) =>\n"
            "    dispatchHistory({ type: 'DUPLICATE', nodeIds: ids, context }), [context]);\n"
            "  const [pending, setPending]",
        ).replace(
            "    pending, propose, applyProposal",
            "    duplicateCanvasNodes,\n    pending, propose, applyProposal",
        )
        self.assertTrue(low_risk_source(WORKFLOW_STORE, "", "", WORKFLOW_SOURCE, history))
        self.assertTrue(low_risk_source(WORKFLOW_STORE, "", "", WORKFLOW_SOURCE, duplicate))

    def test_workflow_store_sensitive_changes_blocked(self):
        anchor = "  const [pending, setPending]"
        for addition in (
            "  const walletSession = useState(null);\n",
            "  const executionAuthority = true;\n",
            "  const rpcResult = fetch('/api/rpc');\n",
            "  const networkCall = window.ethereum.request({ method: 'eth_chainId' });\n",
            "  const run = import('../app/mode-a-action');\n",
        ):
            with self.subTest(addition=addition):
                changed = WORKFLOW_SOURCE.replace(anchor, addition + anchor)
                self.assertFalse(low_risk_source(WORKFLOW_STORE, "", "", WORKFLOW_SOURCE, changed))
        changed_import = WORKFLOW_SOURCE.replace("type Pending =", "import { sign } from '../wallet/eip1193';\ntype Pending =")
        self.assertFalse(low_risk_source(WORKFLOW_STORE, "", "", WORKFLOW_SOURCE, changed_import))
        protected = WORKFLOW_SOURCE.replace("dispatchChain({ type: 'REVISION_ACCEPTED', workflow: state.workflow });", "dispatchChain({ type: 'EXECUTE', workflow: state.workflow });")
        self.assertFalse(low_risk_source(WORKFLOW_STORE, "", "", WORKFLOW_SOURCE, protected))

    def test_simulate_visual_assertion_and_exact_snapshots(self):
        anchor = "  await expect(page).toHaveScreenshot('simulate-current.png', { fullPage: true });"
        visual = "  await expect(panel(page).locator('.simulate-grid')).toBeVisible();\n"
        changed = SIMULATE_SOURCE.replace(anchor, visual + anchor)
        self.assertTrue(low_risk_path(SIMULATE_SPEC))
        self.assertTrue(low_risk_source(SIMULATE_SPEC, "", "", SIMULATE_SOURCE, changed))
        for name in ("simulate-current", "simulate-expired", "simulate-invalidated"):
            path = PREFIX + f"e2e/mock-artifact-chain.spec.ts-snapshots/{name}-chromium-linux.png"
            with self.subTest(path=path):
                self.assertTrue(low_risk_path(path))

    def test_simulate_semantics_and_other_snapshots_stay_protected(self):
        changes = (
            ("await expect(page.getByRole('region', { name: 'Execute unavailable' }))", "await expect(page.getByRole('region', { name: 'Execute ready' }))"),
            ("expect(simulation.value.artifactSetHash).toBe(setHash);", "expect(simulation.value.artifactSetHash).toBe('anything');"),
            ("await expect(panel(page).locator('[data-mocked-value]')).toHaveCount(0);", "await expect(panel(page).locator('[data-mocked-value]')).toHaveCount(1);"),
        )
        for before, after in changes:
            with self.subTest(before=before):
                self.assertIn(before, SIMULATE_SOURCE)
                changed = SIMULATE_SOURCE.replace(before, after, 1)
                self.assertFalse(low_risk_source(SIMULATE_SPEC, "", "", SIMULATE_SOURCE, changed))
        screenshot = "  await expect(page).toHaveScreenshot('simulate-current.png', { fullPage: true });"
        self.assertFalse(low_risk_source(SIMULATE_SPEC, "", "", SIMULATE_SOURCE, SIMULATE_SOURCE.replace(screenshot, "")))
        unsafe = "  await expect(panel(page).locator('.simulate-grid')).toHaveCSS(fetch('/rpc'), 'x');\n"
        self.assertFalse(low_risk_source(SIMULATE_SPEC, "", "", SIMULATE_SOURCE, SIMULATE_SOURCE.replace(screenshot, unsafe + screenshot)))
        self.assertFalse(low_risk_path(PREFIX + "e2e/mock-artifact-chain.spec.ts-snapshots/unrelated-chromium-linux.png"))

    def test_base_observation_only_opens_the_existing_disclosure(self):
        navigation = "await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate' }).click();"
        disclosure = "await page.getByRole('button', { name: 'Show technical details' }).click();"
        lines = BASE_OBSERVATION_SOURCE.splitlines()
        self.assertEqual(sum(line.strip() == navigation for line in lines), 5)
        self.assertEqual(sum(line.strip() == disclosure for line in lines), 5)
        pre_hotfix_lines = [line for index, line in enumerate(lines)
                            if not (line.strip() == disclosure and index > 0 and lines[index - 1].strip() == navigation)]
        self.assertEqual(len(lines) - len(pre_hotfix_lines), 5)
        pre_hotfix = "\n".join(pre_hotfix_lines) + "\n"
        self.assertTrue(low_risk_path(BASE_OBSERVATION_SPEC))
        self.assertTrue(low_risk_source(BASE_OBSERVATION_SPEC, "", "", pre_hotfix, BASE_OBSERVATION_SOURCE))
        self.assertTrue(low_risk_path(PREFIX + "e2e/interface-honesty.spec.ts"))

        protected = (
            ("'REPLAY_MISMATCH'", "'REPLAY_ACCEPTED'"),
            ("'RECORDED REPLAY · NOT LIVE'", "'LIVE'"),
            ("'Not an authorization input'", "'Authorization input'"),
            ("getByRole('button', { name: 'Review swap' })).toBeDisabled()", "getByRole('button', { name: 'Review swap' })).toBeEnabled()"),
            ("networkGuard.assertClean();", "networkGuard.assertDirty();"),
            ("'Read Base quote'", "'Change RPC quote'"),
        )
        for before, after in protected:
            with self.subTest(before=before):
                self.assertIn(before, BASE_OBSERVATION_SOURCE)
                self.assertFalse(low_risk_source(BASE_OBSERVATION_SPEC, "", "", pre_hotfix,
                                                 BASE_OBSERVATION_SOURCE.replace(before, after, 1)))
        self.assertFalse(low_risk_source(BASE_OBSERVATION_SPEC, "", "", BASE_OBSERVATION_SOURCE,
                                         BASE_OBSERVATION_SOURCE.replace("'REPLAY_MISMATCH'", "'REPLAY_ACCEPTED'")))

    def test_exact_observation_and_authoring_snapshots_only(self):
        approved = (
            "e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png",
            "e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png",
            "e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png",
            "e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png",
        )
        for path in approved:
            with self.subTest(path=path):
                self.assertTrue((Path(__file__).resolve().parents[1] / PREFIX / path).is_file())
                self.assertTrue(low_risk_path(PREFIX + path))
        for path in (
            "e2e/base-observation.spec.ts-snapshots/observation-other-chromium-linux.png",
            "e2e/swap-authoring.spec.ts-snapshots/unrelated-chromium-linux.png",
            "e2e/swap-authoring.spec.ts",
            "src/server/base-rpc.ts",
        ):
            with self.subTest(path=path):
                self.assertFalse(low_risk_path(PREFIX + path))


class Hotfix002ScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/governance.yml").read_text()
        phase = workflow.split("          python3 - <<'PYCODE'\n", 1)[1].split("          PYCODE", 1)[0]
        module = ast.parse(textwrap.dedent(phase))
        names = {"HOTFIX_002_BASE", "HOTFIX_002_REFS", "HOTFIX_002_TEST_BYTES", "HOTFIX_002_POLICY_FILES"}
        policy = [node for node in module.body if
                  isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in names
                                                        for target in node.targets)]
        policy += [node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "hotfix_002_scope"]
        if len(policy) != 5:
            raise AssertionError("HOTFIX-002 workflow policy is missing or duplicated")
        namespace = {"hashlib": hashlib}
        exec(compile(ast.Module(body=policy, type_ignores=[]), str(root / ".github/workflows/governance.yml"), "exec"), namespace)
        cls.scope = staticmethod(namespace["hotfix_002_scope"])
        cls.base = namespace["HOTFIX_002_BASE"]
        cls.refs = namespace["HOTFIX_002_REFS"]
        cls.digests = namespace["HOTFIX_002_TEST_BYTES"]
        cls.policy_files = namespace["HOTFIX_002_POLICY_FILES"]
        cls.files = {path: (root / path).read_bytes() for path in cls.digests}
        cls.changed = set(cls.files) | cls.policy_files

    def test_exact_current_hotfix_diff_accepted(self):
        expected = {
            "apps/reference-dapp/e2e/mode-a-adversarial.spec.ts",
            "apps/reference-dapp/e2e/mode-a-fixtures.ts",
            "apps/reference-dapp/e2e/mode-a-fork.spec.ts",
            "apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/fork-simulated-chromium-linux.png",
            "scripts/test_governance_ux_scope.py",
        }
        self.assertEqual(set(self.digests), expected)
        self.assertEqual(self.policy_files, {".github/workflows/governance.yml"})
        self.assertTrue(self.scope(self.base, "codex/hotfix-002-simulate-test-migration", self.changed, self.files))
        self.assertTrue(self.scope(self.base, "main", self.changed, self.files))

    def test_mode_a_execution_assertion_change_blocked(self):
        path = PREFIX + "e2e/mode-a-fork.spec.ts"
        source = self.files[path].decode()
        assertion = "toHaveText('RECONCILED')"
        self.assertIn(assertion, source)
        changed = dict(self.files, **{path: source.replace(assertion, "toHaveText('DIVERGENT')", 1).encode()})
        self.assertFalse(self.scope(self.base, "codex/hotfix-002-simulate-test-migration", self.changed, changed))

    def test_mode_a_wallet_behavior_change_blocked(self):
        path = PREFIX + "e2e/mode-a-fixtures.ts"
        source = self.files[path].decode()
        statement = "if (this.fault.reject)"
        self.assertIn(statement, source)
        changed = dict(self.files, **{path: source.replace(statement, "if (!this.fault.reject)", 1).encode()})
        self.assertFalse(self.scope(self.base, "codex/hotfix-002-simulate-test-migration", self.changed, changed))

    def test_mode_a_rpc_fork_behavior_change_blocked(self):
        path = PREFIX + "e2e/mode-a-fixtures.ts"
        source = self.files[path].decode()
        statement = "await forkRpc('eth_chainId') !== '0x7a69'"
        self.assertIn(statement, source)
        changed = dict(self.files, **{path: source.replace(statement, "await forkRpc('eth_chainId') === '0x7a69'", 1).encode()})
        self.assertFalse(self.scope(self.base, "codex/hotfix-002-simulate-test-migration", self.changed, changed))

    def test_unrelated_mode_a_snapshot_blocked(self):
        approved = PREFIX + "e2e/mode-a-fork.spec.ts-snapshots/fork-simulated-chromium-linux.png"
        unrelated = PREFIX + "e2e/mode-a-fork.spec.ts-snapshots/manifest-review-chromium-linux.png"
        changed = dict(self.files)
        changed[unrelated] = changed.pop(approved)
        self.assertFalse(self.scope(self.base, "codex/hotfix-002-simulate-test-migration",
                                    (self.changed - {approved}) | {unrelated}, changed))

    def test_other_mode_a_e2e_file_blocked(self):
        other = PREFIX + "e2e/mode-a-recovery.spec.ts"
        changed = dict(self.files, **{other: self.files[PREFIX + "e2e/mode-a-fork.spec.ts"]})
        self.assertFalse(self.scope(self.base, "codex/hotfix-002-simulate-test-migration", self.changed | {other}, changed))

    def test_other_base_branch_or_changed_path_blocked(self):
        self.assertFalse(self.scope("0" * 40, "codex/hotfix-002-simulate-test-migration", self.changed, self.files))
        self.assertFalse(self.scope(self.base, "codex/other", self.changed, self.files))
        self.assertFalse(self.scope(self.base, "codex/hotfix-002-simulate-test-migration",
                                    self.changed | {PREFIX + "e2e/mode-a-recovery.spec.ts"}, self.files))


if __name__ == "__main__":
    unittest.main()
