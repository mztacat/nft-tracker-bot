#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting $1..."
if [ "$1" = "worker" ]; then
  exec node dist/worker.js
else
  exec node dist/index.js
fi
