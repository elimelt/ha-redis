#!/bin/bash
# Stop the HA Redis cluster

set -e

echo "Stopping HA Redis cluster..."
docker-compose down

echo "HA Redis cluster stopped."
echo "To remove all data, run: docker-compose down -v"

