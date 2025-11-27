#!/bin/bash
# Monitor the DragonflyDB HA cluster in real-time

echo "Monitoring DragonflyDB HA cluster (press Ctrl+C to stop)..."
echo ""

while true; do
    clear
    echo "=== DragonflyDB HA Cluster Monitor ==="
    echo "Updated: $(date)"
    echo ""
    
    # Container status
    echo "Container Status:"
    docker ps --filter "name=dragonfly-" --format "table {{.Names}}\t{{.Status}}"
    echo ""
    
    # Primary stats
    echo "Primary (6379):"
    docker exec dragonfly-primary redis-cli -p 6379 INFO STATS 2>/dev/null | grep -E "total_commands_processed|instantaneous_ops_per_sec" || echo "  Not available"
    echo ""
    
    # Replica 1 stats
    echo "Replica 1 (6380):"
    docker exec dragonfly-replica-1 redis-cli -p 6380 INFO STATS 2>/dev/null | grep -E "total_commands_processed|instantaneous_ops_per_sec" || echo "  Not available"
    echo ""
    
    # Replica 2 stats
    echo "Replica 2 (6381):"
    docker exec dragonfly-replica-2 redis-cli -p 6381 INFO STATS 2>/dev/null | grep -E "total_commands_processed|instantaneous_ops_per_sec" || echo "  Not available"
    echo ""

    # Go app stats
    echo "Go App Stats:"
    curl -s http://localhost:3002/stats 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  Not available"
    echo ""

    sleep 2
done

