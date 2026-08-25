#!/usr/bin/env bash
set -euo pipefail

# Backs up the momtest-db Postgres container to S3.
# Scheduled daily via momtest-backup.timer — see aws/momtest-backup.service
# and aws/momtest-backup.timer (systemd; this host has no cron/crond).
# Equivalent crontab schedule, for reference: 0 3 * * * (03:00 UTC daily)
#
# Exit codes: 0 success | 1 env/dependency error | 2 pg_dump failed
#             4 S3 upload failed | 5 upload verification failed
#
# Disaster recovery — restore the latest backup into momtest-db:
#   LATEST_KEY=$(aws s3api list-objects-v2 \
#     --bucket momtest-ai-storage-820140266422 --prefix backups/database/ \
#     --query 'sort_by(Contents,&LastModified)[-1].Key' --output text --region eu-central-1)
#   aws s3 cp "s3://momtest-ai-storage-820140266422/${LATEST_KEY}" - --region eu-central-1 \
#     | gunzip \
#     | docker exec -i momtest-db psql -U momtest momtest
# The dump uses --clean --if-exists so it's safe to restore into a live database,
# but do so deliberately (stop the app container first) — see DEPLOYMENT.md.

REGION="${AWS_REGION:-eu-central-1}"
SECRET_PREFIX="momtest-ai"
BUCKET="momtest-ai-storage-820140266422"
S3_PREFIX="backups/database"
DB_CONTAINER="momtest-db"
BACKUP_DIR="/opt/momtest-ai/backups"
LOG_FILE="/var/log/momtest-backup.log"

TIMESTAMP="$(date -u '+%Y-%m-%d_%H%M%S')"
LOCAL_FILE="${BACKUP_DIR}/momtest_backup_${TIMESTAMP}.sql.gz"
S3_KEY="${S3_PREFIX}/momtest_backup_${TIMESTAMP}.sql.gz"

log() {
  local msg="[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}
fail() {
  local code="$1"; shift
  log "ERROR: $*"
  exit "$code"
}
get_secret() {
  aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" --query SecretString --output text
}

mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE"
log "Starting backup: container=${DB_CONTAINER} target=s3://${BUCKET}/${S3_KEY}"

command -v docker >/dev/null 2>&1 || fail 1 "docker not found in PATH"
command -v aws    >/dev/null 2>&1 || fail 1 "aws CLI not found in PATH"
command -v gzip   >/dev/null 2>&1 || fail 1 "gzip not found in PATH"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  fail 1 "container ${DB_CONTAINER} is not running"
fi

database_url="$(get_secret "${SECRET_PREFIX}/DATABASE_URL")"
if [[ -z "$database_url" || "$database_url" == "None" ]]; then
  fail 1 "DATABASE_URL secret is empty"
fi

log "Running pg_dump inside ${DB_CONTAINER}..."
if ! printf '%s' "$database_url" \
    | docker exec -i "$DB_CONTAINER" sh -c 'read -r url && pg_dump --clean --if-exists "$url"' \
    | gzip > "$LOCAL_FILE"; then
  unset database_url
  rm -f "$LOCAL_FILE"
  fail 2 "pg_dump (or gzip) failed while producing ${LOCAL_FILE}"
fi
unset database_url

if [[ ! -s "$LOCAL_FILE" ]]; then
  rm -f "$LOCAL_FILE"
  fail 2 "backup file ${LOCAL_FILE} is empty after dump"
fi

DUMP_SIZE="$(stat -c%s "$LOCAL_FILE" 2>/dev/null || stat -f%z "$LOCAL_FILE")"
log "Dump complete: ${LOCAL_FILE} (${DUMP_SIZE} bytes)"

log "Uploading to s3://${BUCKET}/${S3_KEY}..."
if ! aws s3 cp "$LOCAL_FILE" "s3://${BUCKET}/${S3_KEY}" --region "$REGION"; then
  fail 4 "upload to s3://${BUCKET}/${S3_KEY} failed; local backup retained at ${LOCAL_FILE}"
fi

log "Verifying upload via head-object..."
if ! aws s3api head-object --region "$REGION" --bucket "$BUCKET" --key "$S3_KEY" >/dev/null 2>&1; then
  fail 5 "head-object verification failed for s3://${BUCKET}/${S3_KEY}; local backup retained at ${LOCAL_FILE}"
fi

rm -f "$LOCAL_FILE"
log "Backup succeeded and verified. Remote object: s3://${BUCKET}/${S3_KEY}"
exit 0
