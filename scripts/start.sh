#!/bin/sh
set -e

echo "Applying database schema..."
npx prisma db push --accept-data-loss

echo "Starting $1..."
if [ "$1" = "worker" ]; then
  exec node dist/worker.js
else
  exec node dist/index.js
fi
