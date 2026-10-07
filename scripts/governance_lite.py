#!/usr/bin/env python3
"""Local safety checks. The human owner authorizes repository changes by PR review."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys


# Retain the old scanner's credential families. Never print matched values.
SECRET_PATTERNS = {
    "credential assignment": r"(?im)\b(?:api[_-]?key|secret|private[_-]?key)[\"']?\s*[:=]\s*(?:[\"']([A-Za-z0-9+/=_-]{16,})[\"']|([A-Za-z0-9+/=_-]{16,})(?=\s*(?:$|#)))",
    "private key PEM": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "GitHub token": r"\bgh[pousr]_[A-Za-z0-9]{36,}\b",
    "AWS access key": r"\bAKIA[0-9A-Z]{16}\b",
    "Slack token": r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b",
    "API token": r"\bsk-[A-Za-z0-9_-]{20,}\b",
    "seed phrase": r"(?i)\b(?:mnemonic|seed[_-]?phrase)\s*[:=]\s*[\"']((?:[a-z]+\s+){11,23}[a-z]+)[\"']",
}
PLACEHOLDER = re.compile(r"(?i)^(?:YOUR[_-].*|REPLACE[_-]ME.*|EXAMPLE[_-].*|PLACEHOLDER[_-].*|<[^>]+>)$")
AUTO_MERGE = re.compile(
    r"(?i)\bgh\s+pr\s+merge\b|enablePullRequestAuto" r"Merge|mergePullRequest\s*\("
    r"|/pulls/" r"[^\s]+/merge\b|\b(?:auto[-_]merge|merge[-_]me)@"
)
GOVERNANCE = ".github/workflows/governance.yml"
CONTRACTS = ".github/workflows/contracts.yml"
AGE_WAIVER = "docs/security/COLOSSEUM-DEPENDENCY-AGE-WAIVER.json"


def dependency_age_waivers(files):
    """Validate pnpm's existing exception setting; never interpret ranges/globs."""
    workspace = files.get("pnpm-workspace.yaml", "")
    blocks = re.findall(r"(?m)^minimumReleaseAgeExclude:[^\n]*\n(?:[ \t]+[^\n]*\n)*", workspace)
    if not blocks:
        return set(), []
    if blocks != ["minimumReleaseAgeExclude:\n  - source-map-js@1.2.2\n"]:
        return set(), ["Dependency age waiver must contain only exact source-map-js@1.2.2"]
    try:
        waiver = json.loads(files.get(AGE_WAIVER, ""))
    except (ValueError, TypeError):
        return set(), ["Missing or invalid owner-approved dependency age waiver metadata"]
    expected = {
        "package": "source-map-js", "version": "1.2.2", "advisory": "GHSA-68fv-2mgg-jv7q",
        "reason": "HIGH security advisory remediation required for Colosseum release",
        "approved_by": "Owner", "temporary": True,
        "removal_condition": "Remove after Colosseum delivery completion once normal dependency-age eligibility is no longer needed",
    }
    if waiver != expected or waiver.get("temporary") is not True:
        return set(), ["Dependency age waiver metadata differs from exact temporary owner approval"]
    return {("source-map-js", "1.2.2")}, []


def dependency_release_age_allowed(name, version, published, cutoff, waivers):
    return published <= cutoff or (name, version) in waivers


def secret_errors(path, body):
    errors = []
    for label, pattern in SECRET_PATTERNS.items():
        for match in re.finditer(pattern, body):
            value = next(group for group in match.groups() if group is not None) if match.lastindex else match.group()
            if PLACEHOLDER.fullmatch(value):
                continue
            line = body.count("\n", 0, match.start()) + 1
            errors.append(f"{path}:{line}: possible {label}")
    return errors


def context_errors(branch, event="local"):
    # CI also verifies owner-merged main. A detached CI checkout is expected;
    # use the event's source branch, not the checkout's symbolic branch.
    if not branch or branch == "HEAD":
        return ["Work must have a named branch"]
    if branch in {"main", "master"} and event != "push":
        return ["Agent work and PRs must use a branch other than main/master"]
    return []


def control_errors(files):
    """Surface obvious gate removal; no hashes, build scopes or approval manifests."""
    errors = []
    required = (GOVERNANCE, CONTRACTS, "scripts/governance_lite.py",
                "scripts/test_governance_lite.py", "CLAUDE.md", "docs/SCOPE_GUARD.md",
                "scripts/bootstrap-ci.py", "pnpm-lock.yaml", "pnpm-workspace.yaml")
    errors.extend("Missing safety control: " + path for path in required if not files.get(path))
    for path, commands in {
        GOVERNANCE: ("python3 -m unittest discover -s scripts -p 'test_governance_lite.py'",
                     "python3 scripts/governance_lite.py", "git diff --check", "git diff --check HEAD^1 HEAD"),
        CONTRACTS: ("python3 scripts/bootstrap-ci.py", "pnpm install --frozen-lockfile --ignore-scripts",
                    "python3 scripts/bootstrap-ci.py --verify-dependencies", "pnpm typecheck", "pnpm lint",
                    "pnpm build", "pnpm schemas:check", "pnpm test", "pnpm test:anvil",
                    "pnpm test:fork --testTimeout=30000", "pnpm audit --audit-level low"),
    }.items():
        body = files.get(path, "")
        for command in commands:
            if not re.search(r"(?m)^          " + re.escape(command) + r"$", body):
                errors.append(f"{path}: required gate missing: {command}")
        # These workflows use unconditional jobs and fail-fast Bash. Only
        # failure diagnostics/artifact steps may be conditional.
        for line in body.splitlines():
            if re.match(r"\s*(?:continue-on-error|if):", line) and line.strip() not in {
                "if: failure()", "if: ${{ failure() && steps.browser.outcome == 'failure' }}"
            }:
                errors.append(f"{path}: conditional or ignored safety gate")
        for step in re.split(r"(?m)^      - ", body):
            if any(re.search(r"(?m)^          " + re.escape(command) + "$", step) for command in commands):
                if (re.search(r"(?m)^\s*if:", step) or "          set -euo pipefail\n" not in step
                        or re.search(r"(?m)^          (?:exit\s+0|set\s+\+e)\b", step)):
                    errors.append(f"{path}: safety step must be unconditional and fail fast")
        if not re.search(r"(?m)^  push:\s*$", body) or not re.search(r"(?m)^  pull_request:\s*$", body):
            errors.append(f"{path}: push/PR trigger missing")
    for path, body in files.items():
        if path.startswith(".github/workflows/"):
            if "\npermissions:\n  contents: read\n" not in body:
                errors.append(f"{path}: read-only permissions required")
            if re.search(r"(?m)^\s*[\w-]+:\s*write\b", body) or "pull_request" + "_target" in body:
                errors.append(f"{path}: privileged workflow")
            if re.search(r"\$\{\{\s*secrets\.", body):
                errors.append(f"{path}: repository secret access in CI")
        if path.startswith((".github/", "scripts/")) and AUTO_MERGE.search(body):
            errors.append(f"{path}: automated merge command")
    try:
        manifest = json.loads(files.get("package.json", "{}"))
        for name, tool in (("typecheck", "turbo run typecheck"), ("build", "turbo run build"),
                           ("schemas:check", "node scripts/export-schemas.mjs --check"),
                           ("lint", "eslint "), ("test", "vitest run ")):
            command = manifest.get("scripts", {}).get(name, "")
            if not command.startswith(tool) or re.search(r"\|\|\s*(?:true|exit\s+0)|--passWithNoTests", command):
                errors.append(f"package.json: {name} gate missing")
        if manifest.get("private") is not True or manifest.get("packageManager") != "pnpm@11.22.0":
            errors.append("package.json: private workspace or approved package manager changed")
        if manifest.get("engines") != {"node": "24.21.0", "pnpm": "11.22.0"}:
            errors.append("package.json: approved toolchain changed")
        for path, body in files.items():
            if path.startswith(("packages/", "apps/")) and path.endswith("/package.json"):
                package = json.loads(body)
                license_path = "LICENSES/" + package.get("license", "") + ".txt"
                if not files.get(license_path) or files.get(path.removesuffix("package.json") + "LICENSE") != files[license_path]:
                    errors.append(f"{path}: package license copy mismatch")
    except (ValueError, TypeError):
        errors.append("Invalid package manifest")
    for line in ("ignore-scripts=true", "engine-strict=true", "strict-peer-dependencies=true", "auto-install-peers=false"):
        if line not in files.get(".npmrc", "").splitlines():
            errors.append(".npmrc: dependency control missing: " + line)
    for line in ("minimumReleaseAge: 10080", "strictPeerDependencies: true", "autoInstallPeers: false"):
        if line not in files.get("pnpm-workspace.yaml", "").splitlines():
            errors.append("pnpm-workspace.yaml: dependency control missing: " + line)
    errors.extend(dependency_age_waivers(files)[1])
    return errors


def validate(files, branch, event="local"):
    errors = context_errors(branch, event) + control_errors(files)
    for path, body in files.items():
        errors.extend(secret_errors(path, body))
    return errors


def main():
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    paths = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split(b"\0")
    files = {}
    errors = []
    for raw in sorted(set(paths) - {b""}):
        path = os.fsdecode(raw)
        file = root / path
        if file.is_symlink():
            errors.append(f"{path}: tracked symlink requires review")
        elif file.is_file():
            data = file.read_bytes()
            if b"\0" not in data:
                try:
                    files[path] = data.decode("utf-8")
                except UnicodeDecodeError:
                    pass
    branch = os.environ.get("GOVERNANCE_BRANCH") or subprocess.check_output(["git", "branch", "--show-current"], text=True).strip()
    errors.extend(validate(files, branch, os.environ.get("GOVERNANCE_EVENT", "local")))
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Governance-lite passed ({len(files)} text files; no build scope or history required)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
