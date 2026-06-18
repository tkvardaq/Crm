#!/bin/bash
set -euo pipefail

# CRM Tool Production Deployment Script
# Usage: ./scripts/deploy.sh [staging|production] [image-tag]

ENVIRONMENT="${1:-production}"
IMAGE_TAG="${2:-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=== CRM Tool Deployment ==="
echo "Environment: $ENVIRONMENT"
echo "Image Tag: $IMAGE_TAG"
echo "Project Root: $PROJECT_ROOT"

cd "$PROJECT_ROOT"

# Load environment
if [[ "$ENVIRONMENT" == "production" ]]; then
    ENV_FILE=".env.production"
    COMPOSE_FILE="docker-compose.prod.yml"
    DOMAIN="${DOMAIN:-app.yourdomain.com}"
    BULL_BOARD_DOMAIN="${BULL_BOARD_DOMAIN:-bull.yourdomain.com}"
    ACME_EMAIL="${ACME_EMAIL:-admin@yourdomain.com}"
else
    ENV_FILE=".env.staging"
    COMPOSE_FILE="docker-compose.staging.yml"
    DOMAIN="${DOMAIN:-staging.yourdomain.com}"
    BULL_BOARD_DOMAIN="${BULL_BOARD_DOMAIN:-bull-staging.yourdomain.com}"
    ACME_EMAIL="${ACME_EMAIL:-admin@yourdomain.com}"
fi

if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found. Copy from .env.example and configure."
    exit 1
fi

export IMAGE_TAG
export DOMAIN
export BULL_BOARD_DOMAIN
export ACME_EMAIL

# Pull latest images
echo "=== Pulling Docker images ==="
docker compose -f "$COMPOSE_FILE" pull

# Run migrations before starting services
echo "=== Running database migrations ==="
docker compose -f "$COMPOSE_FILE" run --rm migrate

# Start services with rolling update
echo "=== Starting services ==="
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# Wait for health checks
echo "=== Waiting for health checks ==="
sleep 10

# Verify deployment
echo "=== Verifying deployment ==="
if curl -f -s "https://$DOMAIN/api/health" > /dev/null; then
    echo "✓ Web health check passed"
else
    echo "✗ Web health check failed"
    docker compose -f "$COMPOSE_FILE" logs web --tail=50
    exit 1
fi

if curl -f -s "https://$BULL_BOARD_DOMAIN/api/health" > /dev/null; then
    echo "✓ Bull Board health check passed"
else
    echo "⚠ Bull Board health check failed (may still be starting)"
fi

# Cleanup old images
echo "=== Cleaning up old images ==="
docker image prune -f --filter "until=24h"

echo "=== Deployment complete ==="
echo "Web: https://$DOMAIN"
echo "Bull Board: https://$BULL_BOARD_DOMAIN"