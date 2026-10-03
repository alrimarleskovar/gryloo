#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Vercel install step for the Flofi frontend/BFF. Uses the SAME digest-verified Node 24.21.0 and pnpm 11.22.0
# bootstrap as CI (scripts/bootstrap-ci.py, Python standard library only) so `engine-strict` and the frozen,
# integrity-checked lockfile are honored exactly. Fails closed if the toolchain cannot be verified.
set -eu
cd "$(dirname "$0")/../.."
for candidate in python3.13 python3.12 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import tarfile,sys; sys.exit(0 if hasattr(tarfile, "data_filter") else 1)'; then PYTHON="$candidate"; break; fi
done
: "${PYTHON:?A Python with tarfile.data_filter is required to verify the pinned toolchain}"
GITHUB_PATH="$(mktemp)"; export GITHUB_PATH
RUNNER_TEMP="$PWD/.flofi-toolchain"; mkdir -p "$RUNNER_TEMP"; export RUNNER_TEMP
"$PYTHON" scripts/bootstrap-ci.py
tail -n 1 "$GITHUB_PATH" > .flofi-toolchain/bin-path
PATH="$(cat .flofi-toolchain/bin-path):$PATH"; export PATH
pnpm install --frozen-lockfile --ignore-scripts
