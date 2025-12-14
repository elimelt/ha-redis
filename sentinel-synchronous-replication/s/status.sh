#!/bin/bash
# Check the status of the HA Redis cluster

set -e

echo "=== Redis Nodes Status ==="
echo ""

echo "Primary (port 6379):"
docker exec redis-primary redis-cli INFO replication | grep -E "role:|connected_slaves:|slave[0-9]:|master_repl_offset:" || echo "  Not available"
echo ""

echo "Replica 1 (port 6380):"
docker exec redis-replica-1 redis-cli INFO replication | grep -E "role:|master_host:|master_port:|master_link_status:|slave_repl_offset:" || echo "  Not available"
echo ""

echo "Replica 2 (port 6381):"
docker exec redis-replica-2 redis-cli INFO replication | grep -E "role:|master_host:|master_port:|master_link_status:|slave_repl_offset:" || echo "  Not available"
echo ""

echo "=== Synchronous Replication Settings ==="
echo ""
echo "Primary configuration:"
docker exec redis-primary redis-cli CONFIG GET min-replicas-to-write
docker exec redis-primary redis-cli CONFIG GET min-replicas-max-lag
echo ""

echo "=== Sentinel Status ==="
echo ""

echo "Sentinel 1 (port 26379):"
docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL master mymaster | grep -E "^(name|ip|port|flags|num-slaves|num-other-sentinels)" || echo "  Not available"
echo ""

echo "Sentinel 2 (port 26380):"
docker exec redis-sentinel-2 redis-cli -p 26379 SENTINEL master mymaster | grep -E "^(name|ip|port|flags|num-slaves|num-other-sentinels)" || echo "  Not available"
echo ""

echo "Sentinel 3 (port 26381):"
docker exec redis-sentinel-3 redis-cli -p 26379 SENTINEL master mymaster | grep -E "^(name|ip|port|flags|num-slaves|num-other-sentinels)" || echo "  Not available"

