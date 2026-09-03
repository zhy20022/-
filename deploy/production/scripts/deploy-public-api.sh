#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$DEPLOY_DIR/.env.public-api"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.public-api.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy .env.public-api.example and replace all placeholders."
  exit 1
fi

if grep -Eq 'example\.com|replace-with' "$ENV_FILE"; then
  echo "Production environment still contains placeholder values."
  exit 1
fi

cd "$DEPLOY_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

API_DOMAIN_NAME=$(sed -n 's/^API_DOMAIN_NAME=//p' "$ENV_FILE" | tail -n 1)
echo "Waiting for https://$API_DOMAIN_NAME/api/health/ready"
attempt=0
until curl --fail --silent --show-error "https://$API_DOMAIN_NAME/api/health/ready" >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "API did not become ready. Inspect: docker compose --env-file .env.public-api -f docker-compose.public-api.yml logs"
    exit 1
  fi
  sleep 2
done

echo "Gamer public API is ready."
