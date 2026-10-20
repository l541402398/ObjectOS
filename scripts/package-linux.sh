#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm build
pnpm --filter @projectos/desktop exec electron-builder --linux AppImage

ARTIFACT=$(ls release/*.AppImage | head -1)
sha256sum "$ARTIFACT" | tee "$ARTIFACT.sha256"
echo "Built: $ARTIFACT"
