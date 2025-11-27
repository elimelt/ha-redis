#!/bin/bash
# Monitor the HA Redis cluster in real-time

echo "Monitoring HA Redis cluster (Ctrl+C to exit)..."
echo ""

while true; do
    clear
    echo "=== HA Redis Cluster Monitor ==="
    echo "Time: $(date)"
    echo ""
    
    echo "=== Container Status ==="
    docker-compose ps
    echo ""
    
    echo "=== Current Master ==="
    docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster 2>/dev/null || echo "Unable to get master info"
    echo ""
    
    echo "=== Replication Info ==="
    echo "Primary:"
    docker exec redis-primary redis-cli INFO replication 2>/dev/null | grep -E "role|connected_slaves" || echo "  Unable to connect"
    echo ""
    echo "Replica 1:"
    docker exec redis-replica-1 redis-cli INFO replication 2>/dev/null | grep -E "role|master_link_status" || echo "  Unable to connect"
    echo ""
    echo "Replica 2:"
    docker exec redis-replica-2 redis-cli INFO replication 2>/dev/null | grep -E "role|master_link_status" || echo "  Unable to connect"
    echo ""
    
    echo "=== Load Generator Stats (last 20 lines) ==="
    docker logs redis-load-generator --tail 20 2>/dev/null || echo "Load generator not running"
    
    sleep 5
done

