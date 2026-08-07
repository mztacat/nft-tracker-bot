#!/bin/bash
set -e

BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/nft-tracker-bot}"
TIMESTAMP=$(date +%F_%H%M)
BACKUP_FILE="$BACKUP_DIR/nftbot_$TIMESTAMP.sql"

echo "=== NFT Tracker Bot Database Backup ==="
echo "Backup target: $BACKUP_FILE"

mkdir -p "$BACKUP_DIR"

cd "$DEPLOY_DIR"

docker compose exec -T db pg_dump -U nftbot nftbot > "$BACKUP_FILE"

echo "Backup complete: $BACKUP_FILE"
echo "Size: $(du -sh "$BACKUP_FILE" | cut -f1)"

# Keep only last 7 daily backups
find "$BACKUP_DIR" -name "nftbot_*.sql" -mtime +7 -delete
echo "Old backups cleaned."

echo ""
echo "To restore from this backup:"
echo "  docker compose exec -T db psql -U nftbot nftbot < $BACKUP_FILE"
