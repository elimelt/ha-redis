#!/bin/bash
# Test failover by stopping the primary instance

set -e

echo "=== DragonflyDB HA Failover Test ==="
echo ""
echo "This script will:"
echo "1. Show current cluster status"
echo "2. Stop the primary instance"
echo "3. Wait for failover"
echo "4. Show new cluster status"
echo "5. Restart the primary instance"
echo ""

read -p "Press Enter to continue..."

echo ""
echo "Step 1: Current cluster status"
echo "================================"
./s/status.sh

echo ""
echo "Step 2: Stopping primary instance..."
echo "====================================="
docker stop dragonfly-primary
echo "Primary stopped."

echo ""
echo "Step 3: Waiting 10 seconds..."
echo "============================="
sleep 10

echo ""
echo "Step 4: Cluster status after primary failure"
echo "============================================="
echo "Note: In a production setup with Sentinel or Kubernetes Operator,"
echo "one of the replicas would be automatically promoted to primary."
echo "In this basic setup, you would need to manually promote a replica."
echo ""
./s/status.sh

echo ""
echo "Step 5: Restarting primary instance..."
echo "======================================="
docker start dragonfly-primary
echo "Primary restarted."

echo ""
echo "Waiting for primary to be ready..."
sleep 5

echo ""
echo "Final cluster status:"
echo "====================="
./s/status.sh

echo ""
echo "Failover test complete!"
echo ""
echo "Note: For automatic failover, consider using:"
echo "  - Redis Sentinel (compatible with DragonflyDB)"
echo "  - DragonflyDB Kubernetes Operator"
echo "  - DragonflyDB Cloud"

