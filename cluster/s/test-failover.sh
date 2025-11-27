#!/bin/bash
# Test automatic failover by stopping a master node

set -e

echo "=== Testing Automatic Failover ==="
echo ""

echo "Current cluster nodes:"
docker exec redis-node-1 redis-cli cluster nodes | grep master
echo ""

echo "Stopping redis-node-1 container to simulate master failure..."
docker-compose stop redis-node-1
echo ""

echo "Waiting for cluster to detect failure and promote a replica (this may take 5-10 seconds)..."
sleep 12

echo ""
echo "Cluster nodes after failover:"
docker exec redis-node-2 redis-cli cluster nodes 2>/dev/null || echo "Checking from node-3..." && docker exec redis-node-3 redis-cli cluster nodes
echo ""

echo "Cluster state:"
docker exec redis-node-2 redis-cli cluster info 2>/dev/null | grep cluster_state || docker exec redis-node-3 redis-cli cluster info | grep cluster_state
echo ""

echo "=== Failover test complete ==="
echo "To restore the failed node, run: docker-compose start redis-node-1"
echo "The node will rejoin the cluster automatically."

