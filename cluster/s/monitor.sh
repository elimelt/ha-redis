#!/bin/bash
# Monitor the Redis Cluster in real-time

echo "Monitoring Redis Cluster (Ctrl+C to exit)..."
echo ""

while true; do
    clear
    echo "=== Redis Cluster Monitor ==="
    echo "Time: $(date)"
    echo ""
    
    echo "=== Container Status ==="
    docker-compose ps
    echo ""
    
    echo "=== Cluster State ==="
    docker exec redis-node-1 redis-cli cluster info 2>/dev/null | grep -E "cluster_state|cluster_slots_assigned|cluster_slots_ok|cluster_known_nodes" || echo "Unable to get cluster info"
    echo ""
    
    echo "=== Cluster Nodes ==="
    docker exec redis-node-1 redis-cli cluster nodes 2>/dev/null || echo "Unable to get cluster nodes"
    echo ""
    
    echo "=== Load Generator Stats (last 20 lines) ==="
    docker logs redis-cluster-load-generator --tail 20 2>/dev/null || echo "Load generator not running"
    
    sleep 5
done

