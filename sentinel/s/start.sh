#!/bin/bash
# Start the HA Redis cluster

set -e

echo "Starting HA Redis cluster..."
docker-compose up -d

echo ""
echo "Waiting for services to be healthy..."
sleep 10

echo ""
echo "Cluster status:"
./s/status.sh

echo ""
echo "HA Redis cluster is running!"
echo "Use './s/status.sh' to check cluster status"
echo "Use './s/monitor.sh' to monitor the cluster"
echo "Use './s/stop.sh' to stop the cluster"

