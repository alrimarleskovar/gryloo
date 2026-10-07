#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Vercel build step: the verified toolchain from install.sh builds the app and the workspace packages it links.
set -eu
cd "$(dirname "$0")/../.."
PATH="$(cat .flofi-toolchain/bin-path):$PATH"; export PATH
test "$(node --version)" = "v24.21.0"
pnpm exec turbo run build --filter='@defi-workflow-engine/reference-dapp...'
# BUILD-CLOUD-PARITY-001: a Preview that runs the embedded runtime on its own database may apply the shipped migrations here,
# only when the owner opts in with FLOFI_MIGRATE_ON_BUILD=preview on the Preview environment. Production migrations stay on the
# API's pre-deploy step. The same advisory-locked, checksum-verified `migrate` command; a failure fails the build.
if [ "${FLOFI_MIGRATE_ON_BUILD:-}" = "preview" ]; then
  if [ "${VERCEL_ENV:-}" != "preview" ]; then echo "FLOFI_MIGRATE_ON_BUILD=preview applies to Vercel Preview builds only" >&2; exit 1; fi
  node apps/reference-dapp/backend/main.ts migrate
fi
