#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-mock}"
REGION="${AWS_REGION:-eu-central-1}"
SECRET_PREFIX="momtest-ai"
RUNTIME_DIR="/run/momtest-ai"
ENV_FILE="${RUNTIME_DIR}/app.env"

case "$MODE" in
  mock|live) ;;
  *) echo "Usage: $0 [mock|live]" >&2; exit 2 ;;
esac

get_secret() {
  aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" --query SecretString --output text
}

database_url="$(get_secret "${SECRET_PREFIX}/DATABASE_URL")"
if [[ -z "$database_url" || "$database_url" == "None" ]]; then
  echo "DATABASE_URL secret is empty" >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
umask 077
printf 'APP_LLM_MODE=%s\nNODE_ENV=production\nDATABASE_URL=%s\n' "$MODE" "$database_url" > "$ENV_FILE"

if [[ "$MODE" == "live" ]]; then
  openai_api_key="$(get_secret "${SECRET_PREFIX}/OPENAI_API_KEY")"
  if [[ -z "$openai_api_key" || "$openai_api_key" == "None" ]]; then
    echo "OPENAI_API_KEY secret is empty" >&2
    rm -f "$ENV_FILE"
    exit 1
  fi
  printf 'OPENAI_API_KEY=%s\n' "$openai_api_key" >> "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"
echo "Runtime environment prepared at $ENV_FILE in $MODE mode."