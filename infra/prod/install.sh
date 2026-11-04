#!/usr/bin/env bash
# First-time setup of Commons on a fresh Ubuntu server: Docker, swap for the
# Rust build, the code from GitHub, a generated infra/prod/.env, then the
# first start. Later updates: infra/prod/update.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/Pfyber/commons/main/infra/prod/install.sh \
#     | bash -s -- DOMAIN CARETAKER_EMAIL
#
# Environment: COMMONS_REPO (default Pfyber/commons), COMMONS_DIR (~/commons),
# COMMONS_DEV=true to start in dev mode (sign-in without SMTP, testing only).
set -euo pipefail

domain="${1:?usage: install.sh DOMAIN CARETAKER_EMAIL}"
email="${2:?usage: install.sh DOMAIN CARETAKER_EMAIL}"
repo="${COMMONS_REPO:-https://github.com/Pfyber/commons.git}"
dir="${COMMONS_DIR:-$HOME/commons}"

if ! command -v docker >/dev/null; then
  echo "== Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

if [ -z "$(swapon --show --noheadings)" ]; then
  echo "== Adding 4 GB swap (cargo build --release needs it on small servers)"
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
fi

if [ ! -d "$dir/.git" ]; then
  echo "== Cloning $repo into $dir"
  sudo apt-get install -y -qq git >/dev/null
  git clone --quiet "$repo" "$dir"
fi
cd "$dir"

env=infra/prod/.env
if [ ! -f "$env" ]; then
  echo "== Writing $env (secrets generated here, never committed)"
  cat > "$env" <<EOF
COMMONS_DOMAIN=$domain
ACME_EMAIL=$email
COMMONS_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
SMTP_URL=
MAIL_FROM=Commons <hello@$domain>
COMMONS_CARETAKERS=$email
COMMONS_FOUNDING_SEASON_END=
COMMONS_DEV=${COMMONS_DEV:-false}
LIVEKIT_API_KEY=API$(openssl rand -hex 8)
LIVEKIT_API_SECRET=$(openssl rand -hex 32)
EOF
  chmod 600 "$env"
fi

echo "== Building and starting (the first build takes 10-20 minutes)"
infra/prod/update.sh
echo
echo "Done: https://$domain"
echo "Open ports 80, 443 (tcp+udp), 7881/tcp and 7882/udp if your host has a firewall."
