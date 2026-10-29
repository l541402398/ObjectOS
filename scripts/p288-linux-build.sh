#!/usr/bin/env bash
# Build the Linux AppImage from the same source tree (ADR-0046).
# Runs inside WSL Ubuntu; the Windows host drives it via `wsl -d Ubuntu -- bash scripts/p288-linux-build.sh`.
set -euo pipefail

SRC="/mnt/c/Users/Administrator/Desktop/workplace/ProjectOS-v2-phase2.4"
WORK="$HOME/projectos-linux-build"
NODE_DIR="$HOME/node-v22.14.0-linux-x64"
NODE_VERSION="v22.14.0"

echo "== node =="
if [ ! -x "$NODE_DIR/bin/node" ]; then
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C "$HOME"
fi
export PATH="$NODE_DIR/bin:$PATH"
node -v
corepack enable --install-directory "$NODE_DIR/bin" >/dev/null 2>&1 || true
corepack prepare pnpm@9.15.0 --activate >/dev/null
pnpm -v

echo "== source sync =="
mkdir -p "$WORK"
rsync -a --delete \
  --exclude node_modules --exclude release --exclude out --exclude .git \
  --exclude '*.log' --exclude '.pnpm-store' \
  "$SRC"/ "$WORK"/

cd "$WORK"

echo "== install =="
pnpm install --frozen-lockfile

echo "== build =="
pnpm build

echo "== linux package =="
pnpm --filter @projectos/desktop exec electron-builder --linux AppImage --config electron-builder.yml

ARTIFACT=$(ls -1 release/*.AppImage 2>/dev/null | head -1 || true)
if [ -z "$ARTIFACT" ]; then
  echo "no AppImage produced" >&2
  ls -la release || true
  exit 1
fi

sha256sum "$ARTIFACT" | tee "$ARTIFACT.sha256"
mkdir -p "$SRC/release/linux"
cp -f "$ARTIFACT" "$SRC/release/linux/"
cp -f "$ARTIFACT.sha256" "$SRC/release/linux/"
echo "copied to $SRC/release/linux/"
ls -la "$SRC/release/linux/"
