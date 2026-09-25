#!/usr/bin/env python3
"""SPDX-License-Identifier: Apache-2.0

Acquire only the BUILD-003D approved Foundry anvil v1.8.3 binary for Linux x64.
The archive digest is the publisher's GitHub-reported digest, equals the
publisher's `.sha256` release asset and was observed locally before approval.
Only `anvil` is extracted; forge, cast, chisel and solar are never written.
"""

import argparse
import hashlib
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request

FOUNDRY_VERSION = "v1.8.3"
ARCHIVE = "foundry_v1.8.3_linux_amd64.tar.gz"
SIZE = 113058051
SHA256 = "7ca48e6ca3cac1bce1403ca67e5bc1dc3bc1fd818199c9957c7165079c228568"
CLASSIFICATION = "PUBLISHER_DIGEST_MATCHED_LOCALLY_OBSERVED_HUMAN_APPROVED"
SOURCE = "https://github.com/foundry-rs/foundry/releases/download/v1.8.3/foundry_v1.8.3_linux_amd64.tar.gz"
FINAL_HOST = "release-assets.githubusercontent.com"
FINAL_PATH = "/github-production-release-asset/404320053/dd7b2a7d-9bd1-47ce-bdf3-552ff6815f2f"
ENTRIES = {"forge": 101244392, "cast": 73880592, "anvil": 50407016, "chisel": 53027632, "solar": 8201728}
ANVIL_SIZE = 50407016
ANVIL_SHA256 = "674a06c97a01350cd00241762bbfb01ebcafce9b6e8cbd6c8758ecea6ef4b968"
ANVIL_VERSION = (
    "anvil Version: 1.8.3\n"
    "Commit SHA: cae51ad458f6abb64852b7709eb784352429825d\n"
    "Build Timestamp: 2026-09-15T10:46:16.519267388Z (1789469176)\n"
    "Build Profile: dist"
)
DESTINATION_NAME = "foundry-v1.8.3"


class ApprovedRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        super().__init__()
        self.redirects = 0

    def redirect_request(self, request, response, code, message, headers, url):
        target = urllib.parse.urlsplit(url)
        if (self.redirects != 0 or request.full_url != SOURCE or code != 302
                or target.scheme != "https" or target.hostname != FINAL_HOST
                or target.port is not None or target.path != FINAL_PATH):
            raise RuntimeError("STOP: unapproved anvil redirect")
        self.redirects += 1
        return urllib.request.Request(url, method="GET")


def validate_entries(archive):
    members = archive.getmembers()
    names = [member.name for member in members]
    if sorted(names) != sorted(ENTRIES) or len(set(names)) != len(names):
        raise RuntimeError("STOP: unexpected anvil archive entries")
    for member in members:
        if not member.isreg() or member.size != ENTRIES[member.name] or "/" in member.name:
            raise RuntimeError("STOP: unsafe or unexpected anvil archive entry")
    return next(member for member in members if member.name == "anvil")


def bootstrap(destination):
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("STOP: approved anvil requires Linux x64")
    destination = Path(destination).absolute()
    if destination.name != DESTINATION_NAME:
        raise RuntimeError("STOP: destination must name the approved Foundry version")
    if destination.exists() or destination.is_symlink():
        raise RuntimeError("STOP: anvil destination must not exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    parent = destination.parent.resolve(strict=True)
    destination = parent / destination.name
    redirect = ApprovedRedirect()
    # Ignore environment proxies; they cannot supply alternate destinations.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), redirect)
    archive_path = None
    staging = None
    try:
        with tempfile.NamedTemporaryFile(prefix="foundry-", suffix=".tar.gz", dir=parent, delete=False) as output:
            archive_path = Path(output.name)
            digest = hashlib.sha256()
            count = 0
            with opener.open(SOURCE, timeout=90) as response:
                final = urllib.parse.urlsplit(response.url)
                if (response.status != 200 or redirect.redirects != 1
                        or final.hostname != FINAL_HOST or final.path != FINAL_PATH):
                    raise RuntimeError("STOP: unapproved anvil response")
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > SIZE:
                        raise RuntimeError("STOP: anvil archive exceeds approved size")
                    digest.update(chunk)
                    output.write(chunk)
        if count != SIZE or digest.hexdigest() != SHA256:
            raise RuntimeError("STOP: anvil archive size or SHA-256 mismatch")
        # Never open the archive before its exact bytes have been verified.
        with tarfile.open(archive_path, "r:gz") as archive:
            member = validate_entries(archive)
            staging = Path(tempfile.mkdtemp(prefix="anvil-staging-", dir=parent))
            target = staging / "anvil"
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError("STOP: anvil entry is not readable")
            anvil_digest = hashlib.sha256()
            written = 0
            with source, target.open("xb") as output:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    anvil_digest.update(chunk)
                    output.write(chunk)
        if written != ANVIL_SIZE or anvil_digest.hexdigest() != ANVIL_SHA256:
            raise RuntimeError("STOP: anvil binary size or SHA-256 mismatch")
        target.chmod(0o755)
        version = subprocess.check_output([str(target), "--version"], text=True, timeout=30).strip()
        if version != ANVIL_VERSION:
            raise RuntimeError("STOP: anvil version mismatch")
        if destination.exists():
            raise RuntimeError("STOP: destination appeared during validation")
        staging.rename(destination)
        staging = None
        print("Foundry:", FOUNDRY_VERSION)
        print("Source:", SOURCE)
        print("Final host and path:", FINAL_HOST + FINAL_PATH)
        print("Archive:", ARCHIVE, "bytes:", count, "SHA-256:", digest.hexdigest())
        print("anvil bytes:", written, "SHA-256:", anvil_digest.hexdigest())
        print("anvil version:", version.splitlines()[0])
        print("Executable:", destination / "anvil")
        print("Integrity classification:", CLASSIFICATION)
    finally:
        if archive_path is not None:
            archive_path.unlink(missing_ok=True)
        if staging is not None:
            shutil.rmtree(staging)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", help="Explicit path whose final component is foundry-v1.8.3")
    bootstrap(parser.parse_args().destination)
