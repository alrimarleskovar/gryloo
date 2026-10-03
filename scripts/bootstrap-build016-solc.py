#!/usr/bin/env python3
"""SPDX-License-Identifier: Apache-2.0
BUILD-016 local test compiler; same 0.8.21 release as the accepted Roles profile.
Official solc-bin Linux x64 binary, exact digest. Never select latest release.
"""
import hashlib
from pathlib import Path
import platform
import subprocess
import sys
import urllib.request

SOURCE = 'https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/linux-amd64/solc-linux-amd64-v0.8.21+commit.d9974bed'
SHA256 = 'f2857a898be15c69e8de5598dcd3f3e169e94964a0ce9a0bbb1b111f145a81df'
if platform.system() != 'Linux' or platform.machine() != 'x86_64':
    raise SystemExit('BUILD016_SOLC_PLATFORM_UNAPPROVED')
target = Path(sys.argv[1]).absolute()
if target.exists():
    raw = target.read_bytes()
else:
    raw = urllib.request.urlopen(SOURCE, timeout=60).read()
if hashlib.sha256(raw).hexdigest() != SHA256:
    raise SystemExit('BUILD016_SOLC_DIGEST_MISMATCH')
if not target.exists():
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as output:
        output.write(raw)
    target.chmod(0o700)
if '0.8.21+commit.d9974bed' not in subprocess.check_output([str(target), '--version'], text=True):
    raise SystemExit('BUILD016_SOLC_VERSION_MISMATCH')
print('BUILD016_SOLC_PIN_VERIFIED')
