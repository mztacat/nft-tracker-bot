#!/bin/bash
set -e

echo "=== NFT Tracker Bot Deployment ==="
echo ""

DEPLOY_DIR="${DEPLOY_DIR:-/opt/nft-tracker-bot}"

echo "Deploy directory: $DEPLOY_DIR"
cd "$DEPLOY_DIR"

echo ""
echo "[1/5] Pulling latest code..."
git pull origin main

echo ""
echo "[2/5] Building containers..."
docker compose build

echo ""
echo "[3/5] Running database migrations..."
docker compose run --rm bot sh -c "npx prisma migrate deploy"

echo ""
echo "[4/5] Restarting services..."
docker compose up -d

echo ""
echo "[5/5] Cleaning up unused Docker resources..."
docker system prune -f

echo ""
echo "=== Deployment complete ==="
docker compose ps

echo ""
echo "Check logs with: docker compose logs -f bot"
