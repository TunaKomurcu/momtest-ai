#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-live}"
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

# OPENAI_MODEL is not a secret — it's an ordinary deploy-time override, passed
# through from this script's own environment if set (e.g. `OPENAI_MODEL=gpt-4o-mini
# sudo -E ./start-momtest-runtime.sh live`). The app defaults to gpt-4o when unset,
# so this line is optional; it's here so the active model is visible in app.env
# rather than only implied by code.
if [[ -n "${OPENAI_MODEL:-}" ]]; then
  printf 'OPENAI_MODEL=%s\n' "$OPENAI_MODEL" >> "$ENV_FILE"
fi

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