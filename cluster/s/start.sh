#!/bin/bash
# Start the Redis Cluster

set -e

echo "Starting Redis Cluster..."
docker-compose up -d

echo ""
echo "Waiting for cluster to initialize (this may take 15-20 seconds)..."
sleep 20

echo ""
echo "Cluster status:"
./s/status.sh

echo ""
echo "Redis Cluster is running!"
echo "Use './s/status.sh' to check cluster status"
echo "Use './s/monitor.sh' to monitor the cluster"
echo "Use './s/stop.sh' to stop the cluster"

