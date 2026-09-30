"""Narrow path policy for ordinary reference DApp UX changes.

Historical build scopes are verified separately by the governance workflow.
An unrecognized path is sensitive and needs an explicit governance approval.
"""

from difflib import SequenceMatcher
from pathlib import PurePosixPath
import re


APP = "apps/reference-dapp/"
WORKFLOW_STORE = APP + "src/state/workflow-store.tsx"
SIMULATE_SPEC = APP + "e2e/mock-artifact-chain.spec.ts"
SIMULATE_SNAPSHOTS = {APP + "e2e/mock-artifact-chain.spec.ts-snapshots/" + name + "-chromium-linux.png"
                      for name in ("simulate-current", "simulate-expired", "simulate-invalidated")}
ASSETS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2"}
UX_COMPONENTS = {"workflow-canvas.tsx", "simulate-panel.tsx", "action-library.tsx", "summary-bar.tsx", "status-badge.tsx"}
UX_TEST = re.compile(r"(?:canvas|visual|ux|interface|simulate|editor|toolbar|layout|keyboard|copy|duplicate)[\w-]*\.spec\.ts$")
UX_HELPER = re.compile(r"(?:canvas-[\w-]+|editor-[\w-]+)\.(?:test\.)?ts$")
SENSITIVE_NAME = re.compile(r"(?:wallet|sign|rpc|network|transaction|execut|capabilit|authoriz|evidence|promot|protocol|adapter|bridge|swap|liquidity|testnet|mainnet|secret|credential|server)", re.I)
SENSITIVE_SOURCE = re.compile(
    r"(?:['\"]use server['\"]|\bfetch\s*\(|\bWebSocket\s*\(|\bXMLHttpRequest\b|"
    r"\bprovider\.request\s*\(|\beth_sendTransaction\b|\bpersonal_sign\b|"
    r"\bsignTypedData\b|\bprocess\.env\b|\bTESTNET_EXECUTED\b|\bMAINNET_EXECUTED\b|"
    r"\b(?:import|from)\s*\(?\s*['\"][^'\"]*(?:/wallet/|/server/|/app/[^'\"]*-action|/state/[^'\"]*(?:wallet|execution|capability)))",
    re.I,
)
SENSITIVE_REMOVAL = re.compile(r"\b(?:checkChainAccess|validateAuthoringWorkflow|lintWorkflow|authorization|evidence|wallet|sign|execut\w*|provider|rpc|network|TESTNET_EXECUTED|MAINNET_EXECUTED)\b", re.I)
WORKFLOW_SENSITIVE = re.compile(r"(?:wallet|sign|rpc|network|fetch|https?|transaction|submit|execut|protocol|capabilit|testnet|mainnet|evidence|promot|server|observation|quote|chain|artifact|accessCheck|review|lintWorkflow|eligib|authoriz|provider|ethereum|request\s*\(|process\.env|use server|eth_)", re.I)
EDITOR_IMPORT = re.compile(r"\s*import(?:\s+type)?\s+.+\s+from\s+['\"]\.\./domain/(?:editor[\w-]*|canvas-[\w-]+)['\"];?\s*$")
SIMULATE_VISUAL_ASSERTION = re.compile(
    r"\s*await expect\((?:panel\(page\)|page)\.locator\(['\"]\.(?:simulate-[\w-]+|canvas-(?:head|foot)|flow-surface|chain-strip)['\"]\)\)\."
    r"(?:toBeVisible\(\)|toHaveCSS\(['\"][\w-]+['\"],\s*['\"][^'\"]*['\"]\)|"
    r"toHaveClass\(/[^/]+/\)|toHaveAttribute\(['\"][\w-]+['\"],\s*['\"][^'\"]*['\"]\));\s*$"
)


def simulate_visual_only(before: str, after: str) -> bool:
    """Only layout assertions in the two screenshot-bearing Simulate tests may change."""
    old, new = before.splitlines(), after.splitlines()
    titles = ("semantic edits invalidate; presentation, dismissal, no-op and stale proposals do not",
              "expiry is detected on tab resume and on access without any timer firing (R-7)")

    def visual_lines(lines: list[str]):
        starts = [i for i, line in enumerate(lines) if line.startswith("test('")]
        if any(sum(title in lines[i] for i in starts) != 1 for title in titles):
            return None
        allowed = set()
        for position, start in enumerate(starts):
            if any(title in lines[start] for title in titles):
                allowed.update(range(start + 1, starts[position + 1] if position + 1 < len(starts) else len(lines)))
        return allowed

    old_allowed, new_allowed = visual_lines(old), visual_lines(new)
    if old_allowed is None or new_allowed is None:
        return False
    for name in ("simulate-current", "simulate-expired", "simulate-invalidated"):
        screenshot = f"await expect(page).toHaveScreenshot('{name}.png', {{ fullPage: true }});"
        if sum(screenshot in line for line in old) != 1 or sum(screenshot in line for line in new) != 1:
            return False
    for tag, i, k, j, l in SequenceMatcher(None, old, new).get_opcodes():
        if tag == "equal":
            continue
        if any(index not in old_allowed or not SIMULATE_VISUAL_ASSERTION.fullmatch(old[index]) for index in range(i, k)):
            return False
        if any(index not in new_allowed or not SIMULATE_VISUAL_ASSERTION.fullmatch(new[index]) for index in range(j, l)):
            return False
    return True


def workflow_store_editor_only(before: str, after: str) -> bool:
    """Allow edits only in the existing editor portion of workflow-store."""
    old, new = before.splitlines(), after.splitlines()

    def regions(lines: list[str]):
        markers = ("type Pending =", "type Store =", "  pending: Pending", "  const dispatch = useCallback",
                   "  const [pending, setPending]", "  return <Context.Provider value={{", "    pending, propose")
        try:
            found = [next(i for i, line in enumerate(lines) if line.startswith(marker)) for marker in markers]
        except StopIteration:
            return None
        if found != sorted(set(found)):
            return None
        pending_type, store, store_end, editor, editor_end, value, value_end = found

        def section(index: int) -> str:
            if index < pending_type:
                return "import"
            if store < index < store_end:
                return "editor"
            if editor < index < editor_end:
                return "editor"
            if value < index < value_end:
                return "editor"
            return "protected"

        return section

    old_section, new_section = regions(old), regions(new)
    if old_section is None or new_section is None:
        return False
    for tag, i, k, j, l in SequenceMatcher(None, old, new).get_opcodes():
        if tag == "equal":
            continue
        changed = [(old_section(index), old[index]) for index in range(i, k)]
        changed += [(new_section(index), new[index]) for index in range(j, l)]
        for section, line in changed:
            if section == "protected" or WORKFLOW_SENSITIVE.search(line) or SENSITIVE_SOURCE.search(line):
                return False
            if section == "import" and not EDITOR_IMPORT.fullmatch(line):
                return False
    return True


def low_risk_path(path: str) -> bool:
    """Allow only named UX categories; all other paths fail closed."""
    if not path.startswith(APP) or ".." in PurePosixPath(path).parts:
        return False
    relative = path[len(APP):]
    if path == WORKFLOW_STORE:
        return True  # Full before/after content is checked by workflow_store_editor_only.
    if path == SIMULATE_SPEC or path in SIMULATE_SNAPSHOTS:
        return True  # The spec also needs the narrow content guard below.
    if relative in ("src/app/globals.css", "src/app/layout.tsx"):
        return True
    if relative.startswith("public/") and PurePosixPath(relative).suffix.lower() in ASSETS:
        return True
    if relative.startswith("e2e/") and ".spec.ts-snapshots/" in relative:
        suffix = relative[len("e2e/"):]
        spec, separator, snapshot = suffix.partition(".spec.ts-snapshots/")
        return bool(separator and UX_TEST.fullmatch(spec + ".spec.ts") and re.fullmatch(r"[\w-]+\.png", snapshot))
    if SENSITIVE_NAME.search(relative):
        return False
    if relative.startswith("src/components/") and relative.count("/") == 2:
        name = PurePosixPath(relative).name
        return name in UX_COMPONENTS or bool(re.fullmatch(r"(?:canvas|toolbar|visual)-[\w-]+\.tsx", name))
    if relative.startswith("src/domain/") and relative.count("/") == 2:
        return bool(UX_HELPER.fullmatch(PurePosixPath(relative).name))
    if relative.startswith("e2e/"):
        suffix = relative[len("e2e/"):]
        if "/" not in suffix:
            return bool(UX_TEST.fullmatch(suffix))
        return False
    return False


def low_risk_source(path: str, added_lines: str, removed_lines: str = "", before: str = "", after: str = "") -> bool:
    """Reject privileged additions and removal of existing safety guards."""
    if path == WORKFLOW_STORE:
        return workflow_store_editor_only(before, after)
    if path == SIMULATE_SPEC:
        return simulate_visual_only(before, after)
    if path.endswith((".ts", ".tsx")) and not path.startswith(APP + "e2e/"):
        return not bool(SENSITIVE_SOURCE.search(added_lines) or SENSITIVE_REMOVAL.search(removed_lines))
    return True
