#!/bin/sh
# Reconcile the Postgres role password with POSTGRES_PASSWORD in .env,
# WITHOUT resetting the database volume or losing data.
#
# Why this is needed: postgres only applies POSTGRES_PASSWORD when the data
# volume is first initialized. If the volume was created with an old password
# and .env now holds a new one, bot/worker fail with Prisma P1000 in a
# restart loop. This script updates the role password inside the running db
# container so it matches .env.
#
# Usage (from the repo root on the VPS):
#   sh scripts/fix-db-password.sh
set -eu

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $(pwd). Run from the repo root." >&2
  exit 1
fi

NEW_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2-)
if [ -z "${NEW_PASSWORD}" ]; then
  echo "ERROR: POSTGRES_PASSWORD is not set in .env" >&2
  exit 1
fi

echo "Ensuring db container is up..."
docker compose up -d db
echo "Waiting for postgres to accept connections..."
i=0
until docker compose exec -T db pg_isready -U nftbot >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 30 ] && { echo "ERROR: postgres did not become ready" >&2; exit 1; }
  sleep 2
done

# ALTER ROLE runs as the local 'postgres' superuser via trust/peer auth inside
# the container, so it works even when the old password is unknown.
echo "Updating role password to match .env..."
docker compose exec -T db psql -U nftbot -d nftbot \
  -c "ALTER ROLE nftbot WITH PASSWORD '$(printf %s "${NEW_PASSWORD}" | sed "s/'/''/g")';" 2>/dev/null \
  || docker compose exec -T -u postgres db psql -d nftbot \
  -c "ALTER ROLE nftbot WITH PASSWORD '$(printf %s "${NEW_PASSWORD}" | sed "s/'/''/g")';"

echo "Restarting bot and worker..."
docker compose up -d --force-recreate bot worker

echo "Done. Check logs with: docker compose logs -f --tail=50 bot worker"
