#!/bin/bash
# Stop the Redis Cluster

set -e

echo "Stopping Redis Cluster..."
docker-compose down

echo ""
echo "Redis Cluster stopped."

