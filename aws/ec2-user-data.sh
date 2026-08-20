#!/bin/bash
# EC2 User Data script — MomTest AI
# Runs automatically on first boot via cloud-init (Amazon Linux 2023).
#
# Usage:
#   Paste into "Advanced Details > User data" when launching an EC2 instance.
#   Or run manually on an existing instance:
#     chmod +x ec2-user-data.sh && sudo ./ec2-user-data.sh

set -euo pipefail

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "Starting MomTest AI setup..."

# ── System update ──────────────────────────────────────────────────────────
yum update -y

# ── Docker ────────────────────────────────────────────────────────────────
yum install -y docker git
systemctl start docker
systemctl enable docker
usermod -aG docker ec2-user

# ── Docker Compose ────────────────────────────────────────────────────────
COMPOSE_VERSION="2.24.0"
curl -SL "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# ── Application directory ─────────────────────────────────────────────────
mkdir -p /opt/momtest
cd /opt/momtest

# Replace with your repository URL. Make the repo public or add a deploy key first.
git clone https://github.com/YOUR_USERNAME/MomTestProject.git .

# ── Environment variables ─────────────────────────────────────────────────
# This first deployment intentionally uses mock mode because the goal is to learn
# the EC2 + Docker deployment flow without creating a bill from a live LLM API.
# For later stages, replace these with AWS Secrets Manager / SSM values.
cat > /opt/momtest/.env << 'EOF'
APP_LLM_MODE=mock
OPENAI_API_KEY=
NVCF_API_KEY=
MAKE_WEBHOOK_INTERVIEW_URL=
MAKE_WEBHOOK_ANALYSIS_URL=
EOF

chmod 600 /opt/momtest/.env

# ── Start application ─────────────────────────────────────────────────────
set +u
source /opt/momtest/.env
set -u

log "Building Docker image (this takes 3-5 minutes)..."
docker-compose --profile app up -d --build

log "Setup complete."
log "Application available at: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3000"
log "Mock mode is active; later set APP_LLM_MODE=live and inject real secrets via AWS Secrets Manager or SSM."
log "Run database migrations: docker compose exec app npx drizzle-kit push"
