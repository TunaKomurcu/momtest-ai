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

# Parse user/password/dbname out of DATABASE_URL (postgresql://user:pass@host:port/db)
# so pg_dump can be run directly via `docker exec` with -U/-d flags and a
# PGPASSWORD env var, instead of piping a connection URI through a subshell.
# (The previous stdin/`read` approach silently failed: `read` returns
# non-zero at EOF when the piped input has no trailing newline, so the `&&`
# after it short-circuited and pg_dump never ran — hence the empty stderr.)
# Host/port from the URL are irrelevant here: pg_dump connects via the
# container's local Unix socket since no -h is given, so DATABASE_URL's
# "db" network alias (which only resolves for *other* containers) is a
# non-issue too.
if [[ "$database_url" =~ ^postgres[a-z]*://([^:@]+):([^@]+)@[^/]+/([^?]+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASS="${BASH_REMATCH[2]}"
  DB_NAME="${BASH_REMATCH[3]}"
else
  unset database_url
  fail 1 "could not parse user/password/dbname out of DATABASE_URL"
fi
unset database_url

PG_DUMP_STDERR_FILE="$(mktemp)"
trap 'rm -f "$PG_DUMP_STDERR_FILE"' EXIT

log "Running pg_dump inside ${DB_CONTAINER}..."
if ! docker exec -e PGPASSWORD="$DB_PASS" "$DB_CONTAINER" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
    2>"$PG_DUMP_STDERR_FILE" \
    | gzip > "$LOCAL_FILE"; then
  unset DB_PASS
  rm -f "$LOCAL_FILE"
  fail 2 "pg_dump (or gzip) failed while producing ${LOCAL_FILE}. pg_dump stderr: $(cat "$PG_DUMP_STDERR_FILE" 2>/dev/null)"
fi
unset DB_PASS

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
