#!/usr/bin/env python3
"""SPDX-License-Identifier: Apache-2.0

Acquire only the BUILD-002 human-approved Linux x64 headless shell.
The accepted digest is locally observed, not a publisher-issued checksum.
"""

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile

PLAYWRIGHT_VERSION = "1.63.0"
REVISION = "1243"
BROWSER_VERSION = "153.0.8010.12"
PLATFORM = "linux-x64"
ARCHIVE = "chrome-headless-shell-linux64.zip"
SIZE = 119809080
SHA256 = "a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d"
CLASSIFICATION = "LOCALLY_OBSERVED_HUMAN_APPROVED"
SOURCE = "https://cdn.playwright.dev/builds/cft/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip"
FINAL = "https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-headless-shell-linux64.zip"
ROOT = "chrome-headless-shell-linux64"
EXECUTABLE = ROOT + "/chrome-headless-shell"
ENTRY_COUNT = 287


class ApprovedRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        super().__init__()
        self.redirects = 0

    def redirect_request(self, request, response, code, message, headers, url):
        if (self.redirects != 0 or request.full_url != SOURCE
                or code != 307 or url != FINAL):
            raise RuntimeError("STOP: unapproved browser redirect")
        self.redirects += 1
        return urllib.request.Request(FINAL, method="GET")


def validate_entries(archive):
    entries = archive.infolist()
    if len(entries) != ENTRY_COUNT:
        raise RuntimeError("STOP: unexpected archive entry count")
    seen = set()
    for entry in entries:
        name = entry.orig_filename
        path = PurePosixPath(name)
        normalized = path.as_posix()
        mode = entry.external_attr >> 16
        kind = stat.S_IFMT(mode)
        if (entry.flag_bits & 1 or not name or "\x00" in name or "\\" in name
                or path.is_absolute() or ".." in path.parts
                or not path.parts or path.parts[0] != ROOT
                or normalized in seen
                or kind not in (0, stat.S_IFREG, stat.S_IFDIR)
                or (kind == stat.S_IFDIR and not entry.is_dir())
                or (kind == stat.S_IFREG and entry.is_dir())):
            raise RuntimeError("STOP: unsafe or unexpected archive entry")
        seen.add(normalized)
    matches = [entry for entry in entries if entry.filename == EXECUTABLE]
    if len(matches) != 1 or matches[0].is_dir():
        raise RuntimeError("STOP: missing or duplicated executable")
    # A file cannot also be the ancestor of another entry.
    files = {PurePosixPath(e.filename) for e in entries if not e.is_dir()}
    if any(parent in files for e in entries for parent in PurePosixPath(e.filename).parents):
        raise RuntimeError("STOP: archive file/directory collision")
    return entries


def bootstrap(destination):
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("STOP: approved browser requires Linux x64")
    destination = Path(destination).absolute()
    if destination.name != "chromium_headless_shell-" + REVISION:
        raise RuntimeError("STOP: destination must name the approved revision")
    if destination.exists() or destination.is_symlink():
        raise RuntimeError("STOP: browser destination must not exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    parent = destination.parent.resolve(strict=True)
    destination = parent / destination.name
    redirect = ApprovedRedirect()
    # Ignore environment proxies; they cannot supply alternate destinations.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), redirect)
    archive_path = None
    staging = None
    try:
        with tempfile.NamedTemporaryFile(prefix="browser-", suffix=".zip", dir=parent, delete=False) as output:
            archive_path = Path(output.name)
            digest = hashlib.sha256()
            count = 0
            with opener.open(SOURCE, timeout=90) as response:
                if response.status != 200 or response.url != FINAL or redirect.redirects != 1:
                    raise RuntimeError("STOP: unapproved browser response")
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > SIZE:
                        raise RuntimeError("STOP: browser archive exceeds approved size")
                    digest.update(chunk)
                    output.write(chunk)
        if count != SIZE or digest.hexdigest() != SHA256:
            raise RuntimeError("STOP: browser archive size or SHA-256 mismatch")
        # Never open the ZIP before its exact bytes have been verified.
        with zipfile.ZipFile(archive_path) as archive:
            entries = validate_entries(archive)
            staging = Path(tempfile.mkdtemp(prefix="browser-staging-", dir=parent))
            for entry in entries:
                target = staging.joinpath(*PurePosixPath(entry.filename).parts).resolve()
                if not target.is_relative_to(staging):
                    raise RuntimeError("STOP: extraction escaped staging directory")
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry) as source, target.open("xb") as output:
                        shutil.copyfileobj(source, output)
                    target.chmod(0o644)
        executable = staging / EXECUTABLE
        executable.chmod(0o755)
        version = subprocess.check_output([str(executable), "--version"], text=True, timeout=30).strip()
        if version != "Google Chrome for Testing " + BROWSER_VERSION:
            raise RuntimeError("STOP: browser executable version mismatch")
        if destination.exists():
            raise RuntimeError("STOP: destination appeared during validation")
        staging.rename(destination)
        staging = None
        print("Browser:", version)
        print("Playwright:", PLAYWRIGHT_VERSION, "revision:", REVISION, "platform:", PLATFORM)
        print("Source:", SOURCE)
        print("Final:", FINAL)
        print("Archive:", ARCHIVE, "bytes:", count, "SHA-256:", digest.hexdigest())
        print("Entries:", ENTRY_COUNT)
        print("Executable:", destination / EXECUTABLE)
        print("Integrity classification:", CLASSIFICATION)
    finally:
        if archive_path is not None:
            archive_path.unlink(missing_ok=True)
        if staging is not None:
            shutil.rmtree(staging)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", help="Explicit cache path ending in chromium_headless_shell-1243")
    bootstrap(parser.parse_args().destination)
