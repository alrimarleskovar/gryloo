#!/usr/bin/env python3
"""Bootstrap the approved toolchain using only Python's standard library."""

import base64
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shlex
import subprocess
import tarfile
import tempfile
import urllib.request

NODE_VERSION = "24.21.0"
PNPM_VERSION = "11.22.0"
NODE_ARCHIVE = f"node-v{NODE_VERSION}-linux-x64.tar.xz"
NODE_URL = f"https://nodejs.org/dist/v{NODE_VERSION}/{NODE_ARCHIVE}"
NODE_SUMS_URL = f"https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt"
NODE_SHA256 = "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"
PNPM_URL = f"https://registry.npmjs.org/pnpm/-/pnpm-{PNPM_VERSION}.tgz"
PNPM_SHA512 = "H/hwxMYTPf2I+yr8Rt0T1H8JyXlLQ4xv20fKmMrzvBY4HuC+k6CRuOOCTPAfiJ9G19niCRD7C+GrD7W6qA3WIQ=="


def fetch(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        if response.status != 200:
            raise RuntimeError(f"Download unavailable: {url}")
        return response.read()


def extract(data, destination):
    # Python's data filter blocks absolute/traversal paths and unsafe links.
    # No compatibility fallback to unrestricted extraction is permitted.
    if not hasattr(tarfile, "data_filter"):
        raise RuntimeError("Python tarfile.data_filter is required")
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        archive.extractall(destination, filter="data")


def checked_output(command):
    result = subprocess.check_output(command, text=True).strip()
    print(result, flush=True)
    return result


def main():
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("The approved toolchain requires Linux x64")
    checked_output(["git", "--version"])
    checked_output(["python3", "--version"])
    print("Toolchain target: linux x64; Corepack is not used", flush=True)
    package = json.loads(Path("package.json").read_text())
    if package["packageManager"] != f"pnpm@{PNPM_VERSION}":
        raise RuntimeError("Root packageManager differs from approved version")
    if Path(".node-version").read_text().strip() != NODE_VERSION:
        raise RuntimeError(".node-version differs from approved version")
    print("packageManager:", package["packageManager"], flush=True)
    sums = fetch(NODE_SUMS_URL).decode("ascii").splitlines()
    entries = [line.split() for line in sums if line.split()[-1:] == [NODE_ARCHIVE]]
    if entries != [[NODE_SHA256, NODE_ARCHIVE]]:
        raise RuntimeError("Official Node checksum entry differs from approved digest")
    node_bytes = fetch(NODE_URL)
    node_digest = hashlib.sha256(node_bytes).hexdigest()
    print("Node SHA-256 expected:", NODE_SHA256, flush=True)
    print("Node SHA-256 actual:  ", node_digest, flush=True)
    if node_digest != NODE_SHA256:
        raise RuntimeError("Node archive checksum mismatch")
    pnpm_bytes = fetch(PNPM_URL)
    pnpm_digest = base64.b64encode(hashlib.sha512(pnpm_bytes).digest()).decode()
    print("pnpm SRI expected: sha512-" + PNPM_SHA512, flush=True)
    print("pnpm SRI actual:   sha512-" + pnpm_digest, flush=True)
    if pnpm_digest != PNPM_SHA512:
        raise RuntimeError("pnpm archive integrity mismatch")
    base = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir()))
    target = Path(tempfile.mkdtemp(prefix="build-001-toolchain-", dir=base))
    extract(node_bytes, target / "node")
    extract(pnpm_bytes, target / "pnpm")
    node = target / "node" / f"node-v{NODE_VERSION}-linux-x64" / "bin" / "node"
    pnpm = target / "pnpm" / "package" / "bin" / "pnpm.mjs"
    if not pnpm.is_file():
        raise RuntimeError("Approved pnpm bin/pnpm.mjs is missing")
    if checked_output([str(node), "--version"]) != "v" + NODE_VERSION:
        raise RuntimeError("Node version mismatch")
    if checked_output([str(node), "-p", "process.platform+' '+process.arch"]) != "linux x64":
        raise RuntimeError("Node runtime architecture mismatch")
    if checked_output([str(node), str(pnpm), "--version"]) != PNPM_VERSION:
        raise RuntimeError("pnpm version mismatch")
    bindir = target / "bin"
    bindir.mkdir()
    (bindir / "node").symlink_to(node)
    shim = bindir / "pnpm"
    shim.write_text("#!/bin/sh\nexec " + shlex.quote(str(node)) + " " +
                    shlex.quote(str(pnpm)) + ' "$@"\n')
    shim.chmod(0o755)
    # Only this verified bin directory is prepended. No runner Node fallback.
    if "GITHUB_PATH" in os.environ:
        with open(os.environ["GITHUB_PATH"], "a", encoding="utf-8") as stream:
            stream.write(str(bindir) + "\n")
    if "GITHUB_ENV" in os.environ:
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as stream:
            stream.write("BUILD001_TOOLCHAIN_BIN=" + str(bindir) + "\n")
    print("BUILD001_TOOLCHAIN_BIN=" + str(bindir), flush=True)



def verify_dependencies():
    """Verify registry metadata against the approved pins and every lock entry.

    pnpm owns YAML parsing and frozen-install validation. This narrow reader
    accepts only its registry-integrity package blocks and fails on other forms.
    """
    import collections
    import concurrent.futures
    import datetime
    import re

    plan = Path("docs/builds/BUILD-001-PLAN.md").read_text()
    pin_rows = re.findall(
        r"(?m)^\| `([^`]+)` \| `([0-9.]+)` \|.*\| ([A-Za-z0-9.-]+) \| `(sha512-[A-Za-z0-9+/=]+)` \|$", plan)
    pins = {name + "@" + version: (license_id, digest)
            for name, version, license_id, digest in pin_rows}
    if len(pins) != 12:
        raise RuntimeError("Expected twelve approved direct dependency pins")
    lock = Path("pnpm-lock.yaml").read_text()
    if lock.count("\npackages:\n") != 1 or lock.count("\nsnapshots:\n") != 1:
        raise RuntimeError("Unrecognized lockfile sections")
    section = lock.split("\npackages:\n")[1].split("\nsnapshots:\n")[0]
    headers = list(re.finditer(r"(?m)^  (\S[^\n]*):$", section))
    locked = {}
    for index, match in enumerate(headers):
        identity = match.group(1).strip("'")
        end = headers[index + 1].start() if index + 1 < len(headers) else len(section)
        integrity = re.findall(r"resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}", section[match.end():end])
        if len(integrity) != 1 or identity in locked:
            raise RuntimeError(f"Non-registry, missing or repeated integrity: {identity}")
        locked[identity] = integrity[0]
    if not locked:
        raise RuntimeError("Empty dependency graph")
    for identity, (_, digest) in pins.items():
        if locked.get(identity) != digest:
            raise RuntimeError(f"Approved direct integrity mismatch: {identity}")
    for path in [Path("package.json"), *Path("packages").glob("*/package.json")]:
        manifest = json.loads(path.read_text())
        for kind in ("dependencies", "devDependencies"):
            for name, version in manifest.get(kind, {}).items():
                if version == "workspace:0.1.0" and name.startswith("@defi-workflow-engine/"):
                    continue
                if name + "@" + version not in pins:
                    raise RuntimeError(f"Unapproved direct pin: {name}@{version}")
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10080)
    allowed_licenses = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}

    def inspect(item):
        identity, integrity = item
        name, version = identity.rsplit("@", 1)
        metadata = json.loads(fetch("https://registry.npmjs.org/" + name.replace("/", "%2f")))
        package = metadata["versions"][version]
        published = metadata["time"][version]
        if package["dist"]["integrity"] != integrity:
            raise RuntimeError(f"Registry integrity changed: {identity}")
        if datetime.datetime.fromisoformat(published.replace("Z", "+00:00")) > cutoff:
            raise RuntimeError(f"Minimum release age failed: {identity}")
        license_id = package.get("license")
        # Exact unmodified development tools reviewed in BUILD-001; this does
        # not approve redistribution, bundling, or a new package with that license.
        tool_exception = (
            license_id == "MPL-2.0" and version == "1.33.0" and
            (name == "lightningcss" or name.startswith("lightningcss-"))
        ) or (license_id == "BlueOak-1.0.0" and identity == "minimatch@10.2.6")
        if license_id not in allowed_licenses and not tool_exception:
            raise RuntimeError(f"Unreviewed dependency license: {identity}: {license_id}")
        if identity in pins and license_id != pins[identity][0]:
            raise RuntimeError(f"Approved direct license changed: {identity}")
        return {"name": name, "version": version, "license": license_id,
                "integrity": integrity, "published": published,
                "engines": package.get("engines", {}),
                "peerDependencies": package.get("peerDependencies", {}),
                "peerDependenciesMeta": package.get("peerDependenciesMeta", {})}

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        records = list(pool.map(inspect, sorted(locked.items())))
    destination = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir())) / "build-001-dependencies.json"
    destination.write_text(json.dumps(records, indent=2, sort_keys=True) + "\n")
    print("Registry entries/integrities/release ages verified:", len(records), flush=True)
    print("License inventory:", dict(sorted(collections.Counter(r["license"] for r in records).items())), flush=True)
    print("Dependency evidence SHA-256:", hashlib.sha256(destination.read_bytes()).hexdigest(), flush=True)


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["--verify-dependencies"]:
        verify_dependencies()
    elif not sys.argv[1:]:
        main()
    else:
        raise SystemExit("Usage: bootstrap-ci.py [--verify-dependencies]")
