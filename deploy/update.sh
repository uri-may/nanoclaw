#!/usr/bin/env bash
set -euo pipefail

# Wags Update Script
# Pulls latest from fork, builds, restarts. Safe to run repeatedly.
#
# Usage:
#   ssh root@<droplet-ip> 'bash -s' < deploy/update.sh

WAGS_USER="wags"
NANOCLAW_DIR="/home/${WAGS_USER}/nanoclaw"
WAGS_UID=$(id -u "${WAGS_USER}")

echo "=== Pulling latest code ==="
sudo -u "${WAGS_USER}" bash -c "cd ${NANOCLAW_DIR} && git fetch origin && git reset --hard origin/main"

echo "=== Installing dependencies ==="
sudo -u "${WAGS_USER}" bash -c "cd ${NANOCLAW_DIR} && npm install"

echo "=== Building ==="
sudo -u "${WAGS_USER}" bash -c "cd ${NANOCLAW_DIR} && npm run build"

echo "=== Running tests ==="
sudo -u "${WAGS_USER}" bash -c "cd ${NANOCLAW_DIR} && npm test" || {
  echo "ERROR: Tests failed. Not restarting."
  exit 1
}

# Restart browser sidecar if running
if docker ps -q -f name=nanoclaw-browser | grep -q .; then
  echo "=== Restarting browser sidecar ==="
  sudo -iu "${WAGS_USER}" bash ~/nanoclaw/deploy/browser-sidecar.sh
fi

echo "=== Restarting NanoClaw ==="
XDG_RUNTIME_DIR="/run/user/${WAGS_UID}" \
DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${WAGS_UID}/bus" \
  sudo -u "${WAGS_USER}" -E systemctl --user restart nanoclaw

sleep 3

echo "=== Status ==="
XDG_RUNTIME_DIR="/run/user/${WAGS_UID}" \
DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${WAGS_UID}/bus" \
  sudo -u "${WAGS_USER}" -E systemctl --user status nanoclaw --no-pager || true

echo ""
echo "Update complete."
