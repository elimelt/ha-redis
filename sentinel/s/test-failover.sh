#!/bin/bash
# Test automatic failover by stopping the primary

set -e

echo "=== Testing Automatic Failover ==="
echo ""

echo "Current master:"
docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
echo ""

echo "Stopping redis-primary container to simulate failure..."
docker-compose stop redis-primary
echo ""

echo "Waiting for Sentinel to detect failure and promote a replica (this may take 5-10 seconds)..."
sleep 12

echo ""
echo "New master after failover:"
docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
echo ""

echo "Sentinel info:"
docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL master mymaster | grep -E "name|ip|port|flags"
echo ""

echo "=== Failover test complete ==="
echo "To restore the original primary, run: docker-compose start redis-primary"
echo "The original primary will rejoin as a replica."

