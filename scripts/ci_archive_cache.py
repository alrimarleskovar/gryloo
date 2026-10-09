"""Untrusted raw-download cache; verify every byte before archive parsing/execution."""

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import shutil
import stat
import tempfile

MAX_ARCHIVE_SIZE = 128 * 1024 * 1024

@contextmanager
def verified_archive(name, parent, download, expected, *, algorithm="sha256", size=None):
    """Yield a private verified copy. A bad cache falls back to a verified download.

    Only raw public archives belong here. The downloader retains its existing
    source/redirect restrictions. Never cache extracted code or trust a cache key.
    """
    if Path(name).name != name or name in {"", ".", ".."}:
        raise ValueError("Cache filename must be a basename")
    cache = None
    configured = os.environ.get("FLOFI_CI_ARCHIVE_CACHE")
    if configured:
        directory = Path(configured)
        if directory.is_symlink():
            raise RuntimeError("Archive cache directory must not be a symlink")
        directory.mkdir(parents=True, exist_ok=True)
        cache = directory / name

    def verify(path):
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, algorithm).hexdigest()
        if actual != expected or (size is not None and path.stat().st_size != size):
            raise RuntimeError("Archive digest/size mismatch: " + name)

    with tempfile.NamedTemporaryFile(prefix="flofi-archive-", dir=parent, delete=False) as output:
        private = Path(output.name)
    hit = False
    try:
        if cache is not None:
            try:
                # O_NONBLOCK also prevents a poisoned FIFO from hanging a gate.
                fd = os.open(cache, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, "rb") as source, private.open("wb") as output:
                    if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                        raise RuntimeError("Cache entry must be a regular file")
                    cached_size = os.fstat(source.fileno()).st_size
                    if cached_size > MAX_ARCHIVE_SIZE or (size is not None and cached_size != size):
                        raise RuntimeError("Cache entry size mismatch")
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                verify(private)
                hit = True
            except (OSError, RuntimeError):
                # Do not parse, extract or execute rejected bytes. Refresh only
                # this entry; never clean other runs' directories/resources.
                print("Archive cache MISS/REJECTED:", name, flush=True)
        if not hit:
            with private.open("wb") as output:
                download(output)
            verify(private)
            if cache is not None:
                with tempfile.NamedTemporaryFile(prefix=".archive-", dir=cache.parent, delete=False) as output:
                    pending = Path(output.name)
                try:
                    shutil.copyfile(private, pending)
                    pending.replace(cache)
                finally:
                    pending.unlink(missing_ok=True)
        print("Archive cache " + ("HIT" if hit else "DOWNLOAD") + ": " + name, flush=True)
        yield private
    finally:
        private.unlink(missing_ok=True)
