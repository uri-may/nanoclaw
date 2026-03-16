#!/usr/bin/env bash
set -euo pipefail

# Wags Phase 1 Deployment Script
# Run as root on a fresh DigitalOcean Ubuntu Droplet.
#
# Usage:
#   ssh root@<droplet-ip> 'bash -s' < deploy/phase-1.sh
#
# Prerequisites (Phase 0 — do these before running this script):
#   - Droplet with Docker installed
#   - Tailscale installed and joined to tailnet
#   - Node.js 22 LTS installed
#   - SSH key-based access as root

FORK_URL="https://github.com/uri-may/nanoclaw.git"
WAGS_USER="wags"
NANOCLAW_DIR="/home/${WAGS_USER}/nanoclaw"

# -------------------------------------------------------------------
# Task 1: Security Hardening
# -------------------------------------------------------------------
echo "=== Task 1: Security Hardening ==="

echo "  Disabling password authentication..."
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd

echo "  Configuring UFW firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh comment "SSH (key-only)"
ufw allow in on tailscale0 comment "Tailscale"
# Docker bridge: containers need to reach credential proxy on host
ufw allow in on docker0 to any port 3001 comment "NanoClaw credential proxy"
ufw --force enable

echo "  Installing fail2ban..."
apt-get install -y -qq fail2ban
systemctl enable fail2ban
systemctl start fail2ban

echo "  Enabling auto security updates..."
apt-get install -y -qq unattended-upgrades
echo 'Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";' \
  > /etc/apt/apt.conf.d/50unattended-upgrades
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' \
  > /etc/apt/apt.conf.d/20auto-upgrades

echo "  Task 1 done."

# -------------------------------------------------------------------
# Task 2: Create Wags User and Clone NanoClaw
# -------------------------------------------------------------------
echo ""
echo "=== Task 2: Create Wags User + Clone NanoClaw ==="

if id "${WAGS_USER}" &>/dev/null; then
  echo "  User ${WAGS_USER} already exists, skipping creation."
else
  echo "  Creating user ${WAGS_USER}..."
  adduser --disabled-password --gecos "" "${WAGS_USER}"
fi

echo "  Adding ${WAGS_USER} to docker group..."
usermod -aG docker "${WAGS_USER}"

echo "  Setting up SSH deploy key for git push..."
WAGS_SSH_DIR="/home/${WAGS_USER}/.ssh"
WAGS_KEY="${WAGS_SSH_DIR}/id_ed25519"
if [ -f "${WAGS_KEY}" ]; then
  echo "  SSH key already exists, skipping."
else
  sudo -u "${WAGS_USER}" mkdir -p "${WAGS_SSH_DIR}"
  sudo -u "${WAGS_USER}" ssh-keygen -t ed25519 -f "${WAGS_KEY}" -N "" -C "wags@vps-deploy-key"
  sudo -u "${WAGS_USER}" ssh-keyscan -t ed25519 github.com >> "${WAGS_SSH_DIR}/known_hosts" 2>/dev/null
  chown "${WAGS_USER}:${WAGS_USER}" "${WAGS_SSH_DIR}/known_hosts"
  echo ""
  echo "  *** ADD THIS DEPLOY KEY TO GITHUB (read-write): ***"
  echo "  https://github.com/uri-may/nanoclaw/settings/keys"
  echo ""
  cat "${WAGS_KEY}.pub"
  echo ""
  echo "  Or via gh CLI from your local machine:"
  echo "  gh repo deploy-key add - --repo uri-may/nanoclaw --title wags-vps-push --allow-write"
  echo ""
fi

echo "  Cloning NanoClaw fork..."
FORK_SSH="git@github.com:uri-may/nanoclaw.git"
sudo -u "${WAGS_USER}" bash -c "
  if [ -d ${NANOCLAW_DIR} ]; then
    echo '  Repo already exists, pulling latest...'
    cd ${NANOCLAW_DIR} && git fetch origin && git reset --hard origin/main
  else
    git clone ${FORK_SSH} ${NANOCLAW_DIR} || git clone ${FORK_URL} ${NANOCLAW_DIR}
  fi
"

echo "  Configuring git identity..."
sudo -u "${WAGS_USER}" bash -c "
  cd ${NANOCLAW_DIR}
  git config user.email 'wags@vps'
  git config user.name 'Wags VPS'
  git remote set-url origin ${FORK_SSH} 2>/dev/null || true
"

echo "  Installing dependencies..."
sudo -u "${WAGS_USER}" bash -c "cd ${NANOCLAW_DIR} && npm install"

echo "  Building..."
sudo -u "${WAGS_USER}" bash -c "cd ${NANOCLAW_DIR} && npm run build"

echo "  Running tests..."
sudo -u "${WAGS_USER}" bash -c "cd ${NANOCLAW_DIR} && npm test" || {
  echo "ERROR: Tests failed. Fix before continuing."
  exit 1
}

echo "  Task 2 done."

# -------------------------------------------------------------------
# Task 3: Install Claude Code (needed for /setup and /customize)
# -------------------------------------------------------------------
echo ""
echo "=== Task 3: Install Claude Code ==="

if command -v claude &>/dev/null; then
  echo "  Claude Code already installed."
else
  echo "  Installing Claude Code..."
  npm install -g @anthropic-ai/claude-code
fi

echo "  Task 3 done."

# -------------------------------------------------------------------
# Task 4: Configure Environment (.env with placeholders)
# -------------------------------------------------------------------
echo ""
echo "=== Task 4: Configure Environment ==="

ENV_FILE="${NANOCLAW_DIR}/.env"

if [ -f "${ENV_FILE}" ]; then
  echo "  .env already exists, skipping creation."
else
  echo "  Creating .env with placeholder values..."
  sudo -u "${WAGS_USER}" bash -c "cat > ${ENV_FILE}" << 'ENVEOF'
# Anthropic (credential proxy handles container isolation)
ANTHROPIC_API_KEY=sk-ant-xxx

# AgentMail
AGENTMAIL_API_KEY=am_xxx
AGENTMAIL_ADDRESS=wags@agentmail.to

# Telegram
TELEGRAM_BOT_TOKEN=xxx

# Owner
OWNER_EMAIL=uri@example.com

# Kill switch
GITHUB_USERNAME=uri-may
KILL_SWITCH_GIST_ID=xxx

# NanoClaw config
ASSISTANT_NAME=Wags
TIMEZONE=Asia/Jerusalem
ENVEOF
fi

echo "  Task 4 done."

# -------------------------------------------------------------------
# Task 5: Create systemd service
# -------------------------------------------------------------------
echo ""
echo "=== Task 5: Systemd Service ==="

echo "  Enabling linger for ${WAGS_USER}..."
loginctl enable-linger "${WAGS_USER}"

SYSTEMD_DIR="/home/${WAGS_USER}/.config/systemd/user"
SERVICE_FILE="${SYSTEMD_DIR}/nanoclaw.service"

echo "  Creating systemd user service..."
sudo -u "${WAGS_USER}" mkdir -p "${SYSTEMD_DIR}"
sudo -u "${WAGS_USER}" bash -c "cat > ${SERVICE_FILE}" << 'SVCEOF'
[Unit]
Description=NanoClaw (Wags)
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/home/wags/nanoclaw
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
SVCEOF

# Helper script for managing the service via SSH as root.
# systemctl --user requires XDG_RUNTIME_DIR and DBUS env vars
# when invoked via sudo rather than a direct login session.
cat > /usr/local/bin/wags << 'WAGSEOF'
#!/usr/bin/env bash
set -euo pipefail
WAGS_UID=$(id -u wags)
export XDG_RUNTIME_DIR="/run/user/${WAGS_UID}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${WAGS_UID}/bus"
exec sudo -u wags -E systemctl --user "$@" nanoclaw
WAGSEOF
chmod +x /usr/local/bin/wags

echo "  Task 5 done."
echo ""
echo "  Helper installed: wags {start|stop|restart|status|journal}"
echo "    Example: wags restart"
echo "    Example: wags status"

# -------------------------------------------------------------------
# Summary and manual steps
# -------------------------------------------------------------------
echo ""
echo "============================================"
echo "  Automated deployment complete."
echo ""
echo "  MANUAL STEPS (in order):"
echo ""
echo "  1. Edit .env with real credentials:"
echo "     sudo -u ${WAGS_USER} nano ${ENV_FILE}"
echo ""
echo "  2. Run NanoClaw setup (builds Docker image):"
echo "     sudo -iu ${WAGS_USER}"
echo "     cd ~/nanoclaw"
echo "     claude /setup"
echo "     # Skip WhatsApp, select Docker as container runtime"
echo "     # This builds the nanoclaw-agent Docker image"
echo ""
echo "  3. Configure Wags identity:"
echo "     claude /customize"
echo "     # Paste the identity description from the plan"
echo ""
echo "  4. Start the service:"
echo "     exit   # back to root"
echo "     wags start"
echo "     wags status"
echo ""
echo "  5. Run verification tests:"
echo "     - Send email to AGENTMAIL_ADDRESS"
echo "     - Set kill switch gist to 'suspended', send email"
echo "     - Set gist back to 'active', send email"
echo "     - nmap -Pn <droplet-ip> (only port 22 open)"
echo "============================================"
echo ""
echo "  UPDATING (after code changes pushed to fork):"
echo "     ssh root@<ip> 'bash -s' < deploy/update.sh"
echo "============================================"
