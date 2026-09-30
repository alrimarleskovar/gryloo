import unittest

from governance_ux_scope import low_risk_path, low_risk_source


PREFIX = "apps/reference-dapp/"


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


if __name__ == "__main__":
    unittest.main()
