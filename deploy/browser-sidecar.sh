#!/usr/bin/env bash
set -euo pipefail

# Browser sidecar: headful Chrome with CDP access for agent automation.
# Runs alongside NanoClaw on the VPS.

CONTAINER_NAME="nanoclaw-browser"
IMAGE="kasmweb/chrome:1.16.1"
CDP_PORT=9222
VNC_PORT=6901 # noVNC for debugging — Tailscale-only access

# Create data directory for browser profile persistence
BROWSER_DATA="/home/wags/nanoclaw-browser-data"
mkdir -p "$BROWSER_DATA"

# Stop existing container if running
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# Copy PAC file into browser data (mounted into container)
cp "$(dirname "$0")/proxy.pac" "$BROWSER_DATA/proxy.pac"

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --shm-size=2g \
  -p 127.0.0.1:${CDP_PORT}:9222 \
  -p 127.0.0.1:${VNC_PORT}:6901 \
  -v "$BROWSER_DATA:/home/kasm-user/data" \
  -e APP_ARGS="--start-maximized --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --proxy-pac-url=file:///home/kasm-user/data/proxy.pac" \
  "$IMAGE"

echo "Browser sidecar started:"
echo "  CDP: localhost:${CDP_PORT}"
echo "  noVNC: localhost:${VNC_PORT}"
