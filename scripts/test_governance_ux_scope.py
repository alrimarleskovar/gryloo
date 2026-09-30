import unittest
from pathlib import Path

from governance_ux_scope import low_risk_path, low_risk_source


PREFIX = "apps/reference-dapp/"
WORKFLOW_STORE = PREFIX + "src/state/workflow-store.tsx"
WORKFLOW_SOURCE = (Path(__file__).resolve().parents[1] / WORKFLOW_STORE).read_text()
SIMULATE_SPEC = PREFIX + "e2e/mock-artifact-chain.spec.ts"
SIMULATE_SOURCE = (Path(__file__).resolve().parents[1] / SIMULATE_SPEC).read_text()


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


if __name__ == "__main__":
    unittest.main()
