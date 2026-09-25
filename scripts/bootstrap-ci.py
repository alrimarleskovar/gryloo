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



# Exactly the 16 human-reviewed BUILD-002 registry identities. This is not a
# license allowlist: each record also pins its SRI, graph route and platform.
BUILD002_REVIEWED_LICENSE_EXCEPTIONS = {'@img/sharp-libvips-darwin-arm64@1.3.3': {'cpu': ['arm64'],
                                           'integrity': 'sha512-suTBPTDGrI9WodccaDdwZItTSaBYASlBk1NSfElSHrUfzu3szG6lvIF58+WiFvnfzuK8ZBFS5zE00PxqxnRiPg==',
                                           'libc': None,
                                           'license': 'LGPL-3.0-or-later',
                                           'optional': True,
                                           'os': ['darwin'],
                                           'route': 'sharp'},
 '@img/sharp-libvips-darwin-x64@1.3.3': {'cpu': ['x64'],
                                         'integrity': 'sha512-FVJZ5mITMobmXIz/hPDTw0EintTW5H3WfrxwLqEqjiIihlu+hVRyGrFQ60xl0Lxn7Bt3zdpevPaQi0HEzqz9fw==',
                                         'libc': None,
                                         'license': 'LGPL-3.0-or-later',
                                         'optional': True,
                                         'os': ['darwin'],
                                         'route': 'sharp'},
 '@img/sharp-libvips-linux-arm64@1.3.3': {'cpu': ['arm64'],
                                          'integrity': 'sha512-0DaL0A6Xu6sQSQFwe4iVCrKWU2cCTItnRsYsCdxAMm9NF6twAA9BKnoqy4hqz4+azQ0JHuA26qiUKsf1XJ/v5A==',
                                          'libc': ['glibc'],
                                          'license': 'LGPL-3.0-or-later',
                                          'optional': True,
                                          'os': ['linux'],
                                          'route': 'sharp'},
 '@img/sharp-libvips-linux-arm@1.3.3': {'cpu': ['arm'],
                                        'integrity': 'sha512-3rbU4vqXXc3hY/OiXdl52xZvT0F1yEngWfvqudtPJg/KkyiaQw2DRsFrNzpmLvfavbwOq3qXn36GP8obHRULQA==',
                                        'libc': ['glibc'],
                                        'license': 'LGPL-3.0-or-later',
                                        'optional': True,
                                        'os': ['linux'],
                                        'route': 'sharp'},
 '@img/sharp-libvips-linux-ppc64@1.3.3': {'cpu': ['ppc64'],
                                          'integrity': 'sha512-cdn1OvUBwsXhbC0zSzJnNzf5MZ/mTrobawDvNXBTxe8VtqKAm0sRuEY2Evzovb/w9JMk4TvRxqt1mekSuJz64w==',
                                          'libc': ['glibc'],
                                          'license': 'LGPL-3.0-or-later',
                                          'optional': True,
                                          'os': ['linux'],
                                          'route': 'sharp'},
 '@img/sharp-libvips-linux-riscv64@1.3.3': {'cpu': ['riscv64'],
                                            'integrity': 'sha512-HjPVx7yKz+0lqdhDlTw1tt90wamBoxhiXpvl1XZpJLiHH4RCJ5yDTqH+VlYPv2fwFs89JFw4c1IexYOcQUi4IQ==',
                                            'libc': ['glibc'],
                                            'license': 'LGPL-3.0-or-later',
                                            'optional': True,
                                            'os': ['linux'],
                                            'route': 'sharp'},
 '@img/sharp-libvips-linux-s390x@1.3.3': {'cpu': ['s390x'],
                                          'integrity': 'sha512-neWLh+3yCNThxnfy3c4BbVBeGgt9aftno+XbT56iK28RgeDs3UOFWviLWlUu0bArYVYJaFDK+RRohbicUNCm8Q==',
                                          'libc': ['glibc'],
                                          'license': 'LGPL-3.0-or-later',
                                          'optional': True,
                                          'os': ['linux'],
                                          'route': 'sharp'},
 '@img/sharp-libvips-linux-x64@1.3.3': {'cpu': ['x64'],
                                        'integrity': 'sha512-4vKmvAst9nrowcqquKFAyZJUDolUaIp8uRiN0mWFguJ1IplC9/pitXtlnnlU4aa/eJw3J7i67V+pwUL+wZGdsA==',
                                        'libc': ['glibc'],
                                        'license': 'LGPL-3.0-or-later',
                                        'optional': True,
                                        'os': ['linux'],
                                        'route': 'sharp'},
 '@img/sharp-libvips-linuxmusl-arm64@1.3.3': {'cpu': ['arm64'],
                                              'integrity': 'sha512-Y9kQaLMuNoB0bPYOOdcZMaseNrFpPodIWWMrx+CZyydf2xn68j9WYc6sWWRrDwNkzCQjKYfc68L7jKjGlHMibw==',
                                              'libc': ['musl'],
                                              'license': 'LGPL-3.0-or-later',
                                              'optional': True,
                                              'os': ['linux'],
                                              'route': 'sharp'},
 '@img/sharp-libvips-linuxmusl-x64@1.3.3': {'cpu': ['x64'],
                                            'integrity': 'sha512-fj8Mv0HHfD1Rr+4I68+3agJynxDWtBFgicTbSOb9Bke6pIwzGcJ+RX/yHjmiEGFMCavY/dxvem7MyNaJF+wDiw==',
                                            'libc': ['musl'],
                                            'license': 'LGPL-3.0-or-later',
                                            'optional': True,
                                            'os': ['linux'],
                                            'route': 'sharp'},
 '@img/sharp-wasm32@0.35.4': {'cpu': None,
                              'integrity': 'sha512-zQnl4Kwp7Q6NHsENtU2T/00Zi+w3AQNwz3+UaTyVBy2FpXrzXzGjndpK61onhZjRtRpQXxCTeqw19bVyXOh7jA==',
                              'libc': None,
                              'license': 'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
                              'optional': True,
                              'os': None,
                              'route': 'wasm'},
 '@img/sharp-win32-arm64@0.35.4': {'cpu': ['arm64'],
                                   'integrity': 'sha512-iNdlBX9gLVvqe2I3uIJSIKTq6wckP/DYxZtcqxm09x5Gi24DnFBmPAWZmr60ZyYMG0xlzo6goG3670ar+RXvRw==',
                                   'libc': None,
                                   'license': 'Apache-2.0 AND LGPL-3.0-or-later',
                                   'optional': True,
                                   'os': ['win32'],
                                   'route': 'sharp'},
 '@img/sharp-win32-ia32@0.35.4': {'cpu': ['ia32'],
                                  'integrity': 'sha512-kqRsbaa5CS6KHlpxnN7WhE6vAAugXyZButpRdvDWetlv6Qv4N9WTcrWzF7tXfB9T7MsoadqdI8hmwLq6UlLvtw==',
                                  'libc': None,
                                  'license': 'Apache-2.0 AND LGPL-3.0-or-later',
                                  'optional': True,
                                  'os': ['win32'],
                                  'route': 'sharp'},
 '@img/sharp-win32-x64@0.35.4': {'cpu': ['x64'],
                                 'integrity': 'sha512-XtmnYhBcrORsJ4XJngyzr/EWP0hRZLAZRFaApdKuviyqF78+ylxh2y06ZmtULAMOnObJ3ucpN0AcwSWnMowTRg==',
                                 'libc': None,
                                 'license': 'Apache-2.0 AND LGPL-3.0-or-later',
                                 'optional': True,
                                 'os': ['win32'],
                                 'route': 'sharp'},
 'caniuse-lite@1.0.30001810': {'cpu': None,
                               'integrity': 'sha512-TITQPUkaz+aVk5GL6NhOdwk1aEaNTSDPsGFWrTuhKGtjTF70jL/Oht2W4c6rXUe5fu7Ie19VIahAXHIIiWWNeg==',
                               'libc': None,
                               'license': 'CC-BY-4.0',
                               'optional': False,
                               'os': None,
                               'route': 'next'},
 'tslib@2.8.1': {'cpu': None,
                 'integrity': 'sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==',
                 'libc': None,
                 'license': '0BSD',
                 'optional': False,
                 'os': None,
                 'route': 'helpers'}}

BUILD002_DIRECT_VERSIONS = {
    "@xyflow/react": "12.11.6",
    "next": "16.3.5",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "@playwright/test": "1.63.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
}

# BUILD-003D exact direct pins (MIT, no license exception). @noble/curves
# depends only on @noble/hashes at the same exact version.
BUILD003D_DIRECT_VERSIONS = {
    "@noble/hashes": "2.4.0",
    "@noble/curves": "2.4.0",
}

# BUILD-003D private AGPL reference packages and their exact dependencies.
BUILD003D_REFERENCE_PACKAGES = {
    "packages/reference-compiler/package.json": ("@defi-workflow-engine/reference-compiler", {
        "@defi-workflow-engine/action-registry": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.2.0",
        "@noble/hashes": "2.4.0",
    }),
    "packages/reference-executor/package.json": ("@defi-workflow-engine/reference-executor", {
        "@defi-workflow-engine/reference-compiler": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.2.0",
    }),
    "packages/reference-reconciler/package.json": ("@defi-workflow-engine/reference-reconciler", {
        "@defi-workflow-engine/reference-compiler": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.2.0",
        "@noble/curves": "2.4.0",
        "@noble/hashes": "2.4.0",
    }),
}

# The pre-existing BUILD-001 MPL tooling exception is exact-name scoped too.
BUILD001_LIGHTNINGCSS_NAMES = {
    "lightningcss",
    "lightningcss-android-arm64",
    "lightningcss-darwin-arm64",
    "lightningcss-darwin-x64",
    "lightningcss-freebsd-x64",
    "lightningcss-linux-arm-gnueabihf",
    "lightningcss-linux-arm64-gnu",
    "lightningcss-linux-arm64-musl",
    "lightningcss-linux-x64-gnu",
    "lightningcss-linux-x64-musl",
    "lightningcss-win32-arm64-msvc",
    "lightningcss-win32-x64-msvc",
}


def verify_dependencies():
    """Verify every registry entry and the exact approved license exceptions.

    Continue through the whole graph, collect all violations, and fail before
    writing evidence if any identity, SPDX expression, SRI, route, platform,
    optional status, publication age, or direct pin differs.
    """
    import collections
    import concurrent.futures
    import datetime
    import re

    errors = []
    plan = Path("docs/builds/BUILD-001-PLAN.md").read_text()
    pin_rows = re.findall(
        r"(?m)^\| `([^`]+)` \| `([0-9.]+)` \|.*\| ([A-Za-z0-9.-]+) \| `(sha512-[A-Za-z0-9+/=]+)` \|$", plan)
    pins = {name + "@" + version: (license_id, digest)
            for name, version, license_id, digest in pin_rows}
    if len(pins) != 12:
        errors.append("Expected twelve approved BUILD-001 direct dependency pins")

    lock = Path("pnpm-lock.yaml").read_text()
    if lock.count("\npackages:\n") != 1 or lock.count("\nsnapshots:\n") != 1:
        raise RuntimeError("Unrecognized lockfile sections")
    resolved_sections = "packages:\n" + lock.split("\npackages:\n", 1)[1]
    if hashlib.sha256(resolved_sections.encode()).hexdigest() != "9e0aaf059085b4d0ac9c367c049eb4ff7d460bf83fd0c09c8530153e6661f749":
        errors.append("Baseline registry packages/snapshots or peer resolutions changed")
    packages_text = lock.split("\npackages:\n", 1)[1].split("\nsnapshots:\n", 1)[0]
    snapshots_text = lock.split("\nsnapshots:\n", 1)[1]

    def blocks(section, allow_empty):
        pattern = r"(?m)^  (\S[^\n]*):(?: \{\})?$" if allow_empty else r"(?m)^  (\S[^\n]*):$"
        headers = list(re.finditer(pattern, section))
        result = {}
        for index, match in enumerate(headers):
            identity = match.group(1).strip("'")
            stop = headers[index + 1].start() if index + 1 < len(headers) else len(section)
            if identity in result:
                errors.append(f"Duplicate lock block: {identity}")
            result[identity] = section[match.end():stop]
        return result

    package_blocks = blocks(packages_text, False)
    snapshot_blocks = blocks(snapshots_text, True)
    locked = {}
    for identity, body in package_blocks.items():
        integrity = re.findall(r"resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}", body)
        if len(integrity) != 1:
            errors.append(f"Non-registry or missing integrity: {identity}")
        else:
            locked[identity] = integrity[0]
    if len(package_blocks) != 247 or len(locked) != 247 or len(snapshot_blocks) != 247:
        errors.append(f"BUILD-003D lock count drift: packages={len(package_blocks)}, "
                      f"registry={len(locked)}, snapshots={len(snapshot_blocks)}")
    for identity, (_, digest) in pins.items():
        if locked.get(identity) != digest:
            errors.append(f"BUILD-001 direct integrity mismatch: {identity}")

    app = json.loads(Path("apps/reference-dapp/package.json").read_text())
    expected_app_dependencies = {
        "@defi-workflow-engine/action-registry": "workspace:0.1.0",
        "@defi-workflow-engine/reference-linter": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.2.0",
        **{key: BUILD002_DIRECT_VERSIONS[key] for key in
           ("@xyflow/react", "next", "react", "react-dom")},
    }
    expected_app_dev = {key: BUILD002_DIRECT_VERSIONS[key] for key in
                        ("@playwright/test", "@types/react", "@types/react-dom")}
    if app.get("dependencies") != expected_app_dependencies or app.get("devDependencies") != expected_app_dev:
        errors.append("BUILD-002 direct manifest versions or workspace links differ")
    linter = json.loads(Path("packages/reference-linter/package.json").read_text())
    expected_linter_dependencies = {
        "@defi-workflow-engine/action-registry": "workspace:0.1.0",
        "@defi-workflow-engine/workflow-contracts": "workspace:0.2.0",
        "ajv": "8.20.0",
        "canonicalize": "5.0.0",
    }
    if (linter.get("name") != "@defi-workflow-engine/reference-linter" or
            linter.get("version") != "0.1.0" or linter.get("private") is not True or
            linter.get("license") != "AGPL-3.0-only" or
            linter.get("dependencies") != expected_linter_dependencies):
        errors.append("BUILD-003A linter manifest identity or exact dependencies differ")
    importer_section = lock.split("\nimporters:\n", 1)[1].split("\npackages:\n", 1)[0]

    def importer_block(path):
        match = re.search(rf"(?ms)^  {re.escape(path)}:\n(.*?)(?=^  \S|\Z)", importer_section)
        return match.group(1) if match else ""

    linter_importer = importer_block("packages/reference-linter")
    expected_linter_importer = """    dependencies:
      '@defi-workflow-engine/action-registry':
        specifier: workspace:0.1.0
        version: link:../action-registry
      '@defi-workflow-engine/workflow-contracts':
        specifier: workspace:0.2.0
        version: link:../workflow-contracts
      ajv:
        specifier: 8.20.0
        version: 8.20.0
      canonicalize:
        specifier: 5.0.0
        version: 5.0.0
"""
    if linter_importer.strip() != expected_linter_importer.strip():
        errors.append("BUILD-003A linter lock importer differs")
    app_importer = importer_section.split("  apps/reference-dapp:\n", 1)[1].split("\n  packages/action-registry:", 1)[0]
    if app_importer.count("'@defi-workflow-engine/reference-linter':") != 1 or not re.search(
            r"(?m)^      '@defi-workflow-engine/reference-linter':\n        specifier: workspace:0\.1\.0\n        version: link:\.\./\.\./packages/reference-linter$",
            app_importer):
        errors.append("BUILD-003A app lock workspace link differs")
    for identity in BUILD002_DIRECT_VERSIONS:
        package_id = identity + "@" + BUILD002_DIRECT_VERSIONS[identity]
        if package_id not in locked:
            errors.append(f"BUILD-002 direct lock identity missing: {package_id}")
    for identity, version in BUILD003D_DIRECT_VERSIONS.items():
        if identity + "@" + version not in locked:
            errors.append(f"BUILD-003D direct lock identity missing: {identity}@{version}")
    for manifest_path, (name, expected) in BUILD003D_REFERENCE_PACKAGES.items():
        manifest = json.loads(Path(manifest_path).read_text())
        if (manifest.get("name") != name or manifest.get("version") != "0.1.0" or
                manifest.get("private") is not True or manifest.get("license") != "AGPL-3.0-only" or
                manifest.get("dependencies") != expected or "devDependencies" in manifest):
            errors.append(f"BUILD-003D reference package manifest differs: {manifest_path}")
        block = importer_block(manifest_path.rsplit("/", 1)[0])
        for dependency, version in expected.items():
            target = ("link:../" + dependency.split("/", 1)[1]) if version.startswith("workspace:") else version
            if f"      '{dependency}':\n        specifier: {version}\n        version: {target}\n" not in block:
                errors.append(f"BUILD-003D lock importer differs: {manifest_path} {dependency}")
    for manifest_path in [Path("package.json"), *Path("packages").glob("*/package.json"),
                          Path("apps/reference-dapp/package.json")]:
        manifest = json.loads(manifest_path.read_text())
        for kind in ("dependencies", "devDependencies"):
            for name, version in manifest.get(kind, {}).items():
                if version in ("workspace:0.1.0", "workspace:0.2.0") and name.startswith("@defi-workflow-engine/"):
                    continue
                if (name + "@" + version not in pins and BUILD002_DIRECT_VERSIONS.get(name) != version
                        and BUILD003D_DIRECT_VERSIONS.get(name) != version):
                    errors.append(f"Unapproved direct pin: {name}@{version}")

    def dependencies(body, group):
        result = {}
        active = None
        for line in body.splitlines():
            header = re.fullmatch(r"    ([A-Za-z]+):", line)
            if header:
                active = header.group(1)
            elif line.startswith("    ") and not line.startswith("      "):
                active = None
            elif active == group and line.startswith("      "):
                pair = line.strip().split(": ", 1)
                if len(pair) == 2:
                    result[pair[0].strip("'")] = pair[1].strip("'")
        return result

    next_keys = [key for key in snapshot_blocks if key.startswith("next@16.3.5(")]
    if len(next_keys) != 1:
        errors.append(f"Expected one pinned Next snapshot, found {len(next_keys)}")
    next_block = snapshot_blocks.get(next_keys[0], "") if len(next_keys) == 1 else ""
    next_dependencies = dependencies(next_block, "dependencies")
    next_optional = dependencies(next_block, "optionalDependencies")
    sharp_ref = next_optional.get("sharp")
    sharp_keys = [key for key in snapshot_blocks if sharp_ref and key == "sharp@" + sharp_ref]
    if len(sharp_keys) != 1:
        errors.append(f"Expected one pinned optional sharp snapshot, found {len(sharp_keys)}")
    sharp_optional = dependencies(snapshot_blocks[sharp_keys[0]], "optionalDependencies") if sharp_keys else {}
    helpers_ref = next_dependencies.get("@swc/helpers")
    helpers_dependencies = dependencies(snapshot_blocks.get("@swc/helpers@" + str(helpers_ref), ""), "dependencies")
    wasm_parents = ("@img/sharp-freebsd-wasm32", "@img/sharp-webcontainers-wasm32")

    def lock_restriction(body, label):
        matches = re.findall(rf"(?m)^    {label}: \[([^]]*)\]$", body)
        if len(matches) > 1:
            errors.append(f"Repeated {label} restriction in lock block")
        return [part.strip() for part in matches[0].split(",")] if matches else None

    def validate_reviewed_lock(identity, approved):
        name, version = identity.rsplit("@", 1)
        body = package_blocks.get(identity, "")
        snapshot = snapshot_blocks.get(identity)
        if not body or snapshot is None:
            errors.append(f"Reviewed package block or snapshot missing: {identity}")
            return
        if locked.get(identity) != approved["integrity"]:
            errors.append(f"Reviewed SRI changed: {identity}")
        for label in ("os", "cpu", "libc"):
            if lock_restriction(body, label) != approved[label]:
                errors.append(f"Reviewed {label} restriction changed: {identity}")
        optional = bool(re.search(r"(?m)^    optional: true$", snapshot))
        if optional != approved["optional"]:
            errors.append(f"Reviewed optional status changed: {identity}")
        route = approved["route"]
        if route == "sharp":
            valid = sharp_optional.get(name) == version and sharp_ref == "0.35.4(@types/node@24.13.4)"
        elif route == "wasm":
            valid = sharp_ref == "0.35.4(@types/node@24.13.4)" and all(
                sharp_optional.get(parent) == "0.35.4" and
                dependencies(snapshot_blocks.get(parent + "@0.35.4", ""), "dependencies").get(name) == version
                for parent in wasm_parents)
        elif route == "next":
            valid = next_dependencies.get(name) == version
        elif route == "helpers":
            valid = helpers_ref == "0.5.23" and helpers_dependencies.get(name) == version
        else:
            valid = False
        if not valid:
            errors.append(f"Reviewed dependency route changed: {identity}")

    for identity, approved in BUILD002_REVIEWED_LICENSE_EXCEPTIONS.items():
        validate_reviewed_lock(identity, approved)

    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10080)
    allowed_licenses = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}

    def inspect(item):
        identity, integrity = item
        name, version = identity.rsplit("@", 1)
        issues = []
        try:
            metadata = json.loads(fetch("https://registry.npmjs.org/" + name.replace("/", "%2f")))
            package = metadata["versions"][version]
            published = metadata["time"][version]
        except Exception as exc:
            return None, [f"Registry metadata unavailable: {identity}: {exc}"], None
        if package.get("dist", {}).get("integrity") != integrity:
            issues.append(f"Registry integrity changed: {identity}")
        try:
            if datetime.datetime.fromisoformat(published.replace("Z", "+00:00")) > cutoff:
                issues.append(f"Minimum release age failed: {identity}")
        except (TypeError, ValueError, AttributeError):
            issues.append(f"Missing or invalid publication time: {identity}")
        license_id = package.get("license")
        legacy_mpl = (license_id == "MPL-2.0" and version == "1.33.0" and
                      name in BUILD001_LIGHTNINGCSS_NAMES)
        legacy_blueoak = (license_id == "BlueOak-1.0.0" and
                          identity == "minimatch@10.2.6")
        rejected = license_id not in allowed_licenses and not legacy_mpl and not legacy_blueoak
        approved = BUILD002_REVIEWED_LICENSE_EXCEPTIONS.get(identity)
        if approved:
            if (license_id != approved["license"] or integrity != approved["integrity"]):
                issues.append(f"Reviewed identity/license/SRI changed: {identity}: {license_id}")
            for label in ("os", "cpu", "libc"):
                if package.get(label) != approved[label]:
                    issues.append(f"Registry {label} restriction changed: {identity}")
        elif rejected:
            issues.append(f"Unreviewed dependency license: {identity}: {license_id}")
        record = {"name": name, "version": version, "license": license_id,
                  "integrity": integrity, "published": published,
                  "engines": package.get("engines", {}),
                  "peerDependencies": package.get("peerDependencies", {}),
                  "peerDependenciesMeta": package.get("peerDependenciesMeta", {}),
                  "os": package.get("os"), "cpu": package.get("cpu"),
                  "libc": package.get("libc"),
                  "optional": bool(re.search(r"(?m)^    optional: true$",
                                              snapshot_blocks.get(identity, "")))}
        return record, issues, rejected

    records = []
    rejected_identities = set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for (identity, _), (record, issues, rejected) in zip(
                sorted(locked.items()), pool.map(inspect, sorted(locked.items()))):
            errors.extend(issues)
            if record is not None:
                records.append(record)
            if rejected:
                rejected_identities.add(identity)
    expected_rejected = set(BUILD002_REVIEWED_LICENSE_EXCEPTIONS)
    if rejected_identities != expected_rejected:
        errors.append(f"Full rejected set drift: missing={sorted(expected_rejected - rejected_identities)}, "
                      f"new={sorted(rejected_identities - expected_rejected)}")
    if len(records) != 247:
        errors.append(f"Incomplete registry review: {len(records)} of 247")
    if errors:
        for error in errors:
            print(error, flush=True)
        raise RuntimeError(f"BUILD-002 dependency verification failed with {len(errors)} violation(s)")

    destination = Path(os.environ.get("RUNNER_TEMP", tempfile.gettempdir())) / "build-002-dependencies.json"
    destination.write_text(json.dumps(records, indent=2, sort_keys=True) + "\n")
    print("Registry entries/integrities/release ages verified:", len(records), flush=True)
    print("Exact reviewed license exception set:", len(rejected_identities), flush=True)
    print("License inventory:",
          dict(sorted(collections.Counter(r["license"] for r in records).items())), flush=True)
    print("Dependency evidence SHA-256:", hashlib.sha256(destination.read_bytes()).hexdigest(), flush=True)

if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["--verify-dependencies"]:
        verify_dependencies()
    elif not sys.argv[1:]:
        main()
    else:
        raise SystemExit("Usage: bootstrap-ci.py [--verify-dependencies]")
