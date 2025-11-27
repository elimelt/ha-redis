#!/bin/bash
# Check the status of the DragonflyDB HA cluster

echo "=== DragonflyDB HA Cluster Status ==="
echo ""

# Check if containers are running
echo "Container Status:"
docker ps --filter "name=dragonfly-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

# Check primary replication info
echo "Primary Replication Info:"
docker exec dragonfly-primary redis-cli -p 6379 INFO REPLICATION 2>/dev/null || echo "Primary not available"
echo ""

# Check replica 1 replication info
echo "Replica 1 Replication Info:"
docker exec dragonfly-replica-1 redis-cli -p 6380 INFO REPLICATION 2>/dev/null || echo "Replica 1 not available"
echo ""

# Check replica 2 replication info
echo "Replica 2 Replication Info:"
docker exec dragonfly-replica-2 redis-cli -p 6381 INFO REPLICATION 2>/dev/null || echo "Replica 2 not available"
echo ""

# Check Go app
echo "Go App Status:"
curl -s http://localhost:3002/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Go app not available"
echo ""

