#!/bin/bash
# Check the status of the Redis Cluster

echo "=== Container Status ==="
docker-compose ps

echo ""
echo "=== Cluster Info ==="
docker exec redis-node-1 redis-cli cluster info

echo ""
echo "=== Cluster Nodes ==="
docker exec redis-node-1 redis-cli cluster nodes

echo ""
echo "=== Cluster Slots Distribution ==="
docker exec redis-node-1 redis-cli cluster slots | head -20

