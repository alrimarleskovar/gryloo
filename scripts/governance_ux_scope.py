"""Narrow path policy for ordinary reference DApp UX changes.

Historical build scopes are verified separately by the governance workflow.
An unrecognized path is sensitive and needs an explicit governance approval.
"""

from pathlib import PurePosixPath
import re


APP = "apps/reference-dapp/"
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


def low_risk_path(path: str) -> bool:
    """Allow only named UX categories; all other paths fail closed."""
    if not path.startswith(APP) or ".." in PurePosixPath(path).parts:
        return False
    relative = path[len(APP):]
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


def low_risk_source(path: str, added_lines: str, removed_lines: str = "") -> bool:
    """Reject privileged additions and removal of existing safety guards."""
    if path.endswith((".ts", ".tsx")) and not path.startswith(APP + "e2e/"):
        return not bool(SENSITIVE_SOURCE.search(added_lines) or SENSITIVE_REMOVAL.search(removed_lines))
    return True
