#!/usr/bin/env bash
set -euo pipefail

# Weekly Docker disk maintenance: removes stopped containers, unused images,
# and build cache older than 7 days. Never touches volumes (momtest-postgres-
# data is safe) — no command here is passed --volumes.
# Scheduled via momtest-docker-cleanup.timer — see momtest-docker-cleanup.service.

LOG_FILE="/var/log/momtest-docker-cleanup.log"

log() {
  local msg="[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

touch "$LOG_FILE"
log "Starting weekly Docker cleanup..."
log "Disk usage before: $(df -h / | tail -n 1)"

log "Pruning stopped containers..."
docker container prune -f >> "$LOG_FILE" 2>&1

log "Pruning unused images older than 7 days..."
docker image prune -af --filter "until=168h" >> "$LOG_FILE" 2>&1

log "Pruning build cache older than 7 days..."
docker builder prune -af --filter "until=168h" >> "$LOG_FILE" 2>&1

log "Disk usage after: $(df -h / | tail -n 1)"
log "Docker cleanup complete."
