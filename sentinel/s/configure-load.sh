#!/bin/bash
# Reconfigure load generator settings

OPERATIONS_PER_SECOND=${1:-100}
READ_WRITE_RATIO=${2:-70}

echo "=== Reconfiguring Load Generator ==="
echo "Operations per second: $OPERATIONS_PER_SECOND"
echo "Read/Write ratio: $READ_WRITE_RATIO% reads"
echo ""

echo "Stopping current load generator..."
docker-compose stop load-generator

echo ""
echo "Updating environment variables..."
export OPERATIONS_PER_SECOND=$OPERATIONS_PER_SECOND
export READ_WRITE_RATIO=$READ_WRITE_RATIO

echo ""
echo "Starting load generator with new settings..."
docker-compose up -d load-generator

echo ""
echo "Load generator reconfigured!"
echo "Monitor with: docker logs -f redis-load-generator"

