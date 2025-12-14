#!/bin/bash
# Start the HA Redis cluster with synchronous replication

set -e

echo "Starting HA Redis cluster with synchronous replication..."
docker-compose up -d

echo ""
echo "Waiting for services to be healthy..."
sleep 10

echo ""
echo "Cluster status:"
./s/status.sh

echo ""
echo "HA Redis cluster with synchronous replication is running!"
echo ""
echo "Configuration:"
echo "  - min-replicas-to-write: 1 (writes need master + 1 replica)"
echo "  - min-replicas-max-lag: 10 seconds"
echo ""
echo "Use './s/status.sh' to check cluster status"
echo "Use './s/stop.sh' to stop the cluster"

