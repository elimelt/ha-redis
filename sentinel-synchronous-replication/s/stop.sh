#!/bin/bash
# Stop the HA Redis cluster

set -e

echo "Stopping HA Redis cluster..."
docker-compose down

echo "HA Redis cluster stopped."

