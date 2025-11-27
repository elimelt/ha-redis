#!/bin/bash
# Check the status of the HA Redis cluster

echo "=== Container Status ==="
docker-compose ps

echo ""
echo "=== Redis Primary Info ==="
docker exec redis-primary redis-cli INFO replication | grep -E "role|connected_slaves|master_host"

echo ""
echo "=== Redis Replica 1 Info ==="
docker exec redis-replica-1 redis-cli INFO replication | grep -E "role|master_host|master_link_status"

echo ""
echo "=== Redis Replica 2 Info ==="
docker exec redis-replica-2 redis-cli INFO replication | grep -E "role|master_host|master_link_status"

echo ""
echo "=== Sentinel 1 Info ==="
docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL master mymaster | grep -E "name|ip|port|flags|num-slaves|num-other-sentinels"

echo ""
echo "=== Sentinel Replicas ==="
docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL replicas mymaster | grep -E "name|ip|port|flags"

