# SPDX-License-Identifier: AGPL-3.0-only
# BUILD-CLOUD-001 backend image: one image, three commands (api | worker | migrate). Portable to Railway,
# ECS/Fargate, Kubernetes or any OCI runtime. The pinned toolchain matches CI exactly (Node 24.21.0 by image
# digest; pnpm 11.22.0 verified against the same SRI as scripts/bootstrap-ci.py; no Corepack). The image holds
# no credentials: all configuration is injected at runtime through the environment.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 NODE_ENV=production
RUN node -e "const c=require('node:crypto'),f=require('node:fs');fetch('https://registry.npmjs.org/pnpm/-/pnpm-11.22.0.tgz').then(r=>r.arrayBuffer()).then(b=>{const d=c.createHash('sha512').update(Buffer.from(b)).digest('base64');if(d!=='H/hwxMYTPf2I+yr8Rt0T1H8JyXlLQ4xv20fKmMrzvBY4HuC+k6CRuOOCTPAfiJ9G19niCRD7C+GrD7W6qA3WIQ==')throw new Error('pnpm integrity mismatch');f.writeFileSync('/tmp/pnpm.tgz',Buffer.from(b));})" \
 && mkdir -p /opt/pnpm && tar -xzf /tmp/pnpm.tgz -C /opt/pnpm && rm /tmp/pnpm.tgz \
 && printf '#!/bin/sh\nexec node /opt/pnpm/package/bin/pnpm.mjs "$@"\n' > /usr/local/bin/pnpm && chmod 755 /usr/local/bin/pnpm \
 && test "$(pnpm --version)" = "11.22.0"
WORKDIR /app
COPY --chown=node:node . .
RUN chown node:node /app
USER node
# Frozen, integrity-checked install without lifecycle scripts; build only the packages the backend imports.
RUN pnpm install --frozen-lockfile --ignore-scripts \
 && pnpm exec turbo run build --filter='@defi-workflow-engine/reference-dapp^...'
EXPOSE 8080
CMD ["node", "apps/reference-dapp/backend/main.ts", "api"]
