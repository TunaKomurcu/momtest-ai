#!/bin/bash
# EC2 User Data script — MomTest AI
# Runs automatically on first boot via cloud-init (Amazon Linux 2023).
#
# Usage:
#   Paste into "Advanced Details > User data" when launching a new EC2 instance.
#   Or run manually on an existing instance:
#     chmod +x ec2-user-data.sh && sudo ./ec2-user-data.sh
#
# NOTE: This script bootstraps the host only. Secrets are loaded at runtime
#       via aws/start-momtest-runtime.sh using AWS Secrets Manager — nothing
#       is hardcoded here.

set -euo pipefail

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "Starting MomTest AI host setup..."

# ── System update ──────────────────────────────────────────────────────────
dnf update -y

# ── Docker ────────────────────────────────────────────────────────────────
dnf install -y docker git
systemctl start docker
systemctl enable docker
usermod -aG docker ec2-user

# ── Application directory ─────────────────────────────────────────────────
mkdir -p /opt/momtest-ai
cd /opt/momtest-ai
git clone https://github.com/TunaKomurcu/momtest-ai.git .
git checkout feature/aws-deployment

# ── Docker network ────────────────────────────────────────────────────────
docker network create app-net || true

# ── PostgreSQL container ──────────────────────────────────────────────────
# Secrets Manager is the source of truth for DATABASE_URL.
# This container is started as a fallback placeholder; the runtime script
# will load the real credentials before starting the app container.
docker run -d \
  --name momtest-db \
  --network app-net \
  --network-alias db \
  --restart unless-stopped \
  -v momtest-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine

log "Host setup complete."
log "Next step: run sudo /opt/momtest-ai/aws/start-momtest-runtime.sh live"
log "Then build the image and start momtest-app as documented in DEPLOYMENT.md"
