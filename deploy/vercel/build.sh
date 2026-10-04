#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Vercel build step: the verified toolchain from install.sh builds the app and the workspace packages it links.
set -eu
cd "$(dirname "$0")/../.."
PATH="$(cat .flofi-toolchain/bin-path):$PATH"; export PATH
test "$(node --version)" = "v24.21.0"
pnpm exec turbo run build --filter='@defi-workflow-engine/reference-dapp...'
