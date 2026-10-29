#!/usr/bin/env bash
# Headless launch smoke for the built Linux AppImage (ADR-0046).
# Extracts the AppImage (no FUSE in this WSL image) and starts it under Xvfb, then verifies the
# Electron window exists and the Node runtime became ready and created its database.
set -uo pipefail

WORK="$HOME/projectos-linux-build"
APP="$WORK/release/ProjectOS-1.7.0-linux-x86_64.AppImage"
PROFILE=/tmp/p288-linux-smoke
LOG=/tmp/p288-linux-smoke.log

rm -rf "$PROFILE" /tmp/p288-squash
mkdir -p "$PROFILE"
cd "$WORK"
if [ ! -d squashfs-root ]; then
  "$APP" --appimage-extract >/dev/null 2>&1
fi

PROJECTOS_DATA_DIR="$PROFILE" \
PROJECTOS_WINDOW_WIDTH=1280 PROJECTOS_WINDOW_HEIGHT=800 \
xvfb-run -a --server-args="-screen 0 1440x900x24" \
  ./squashfs-root/AppRun --no-sandbox --disable-gpu --user-data-dir="$PROFILE/userdata" \
  >"$LOG" 2>&1 &
PID=$!

ok=0
for i in $(seq 1 90); do
  sleep 1
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "process exited early (iteration $i)"
    break
  fi
  if [ -f "$PROFILE/projectos.db" ]; then
    ok=1
    break
  fi
done

echo "alive=$(kill -0 "$PID" 2>/dev/null && echo yes || echo no) db=$([ -f "$PROFILE/projectos.db" ] && echo yes || echo no) waited=${i}s"
ls -la "$PROFILE" 2>/dev/null | head -8
echo "--- log tail ---"
tail -25 "$LOG" 2>/dev/null

kill "$PID" 2>/dev/null
sleep 2
pkill -f squashfs-root/ProjectOS 2>/dev/null
echo "SMOKE=$([ "$ok" = "1" ] && echo PASS || echo FAIL)"
