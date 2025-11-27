#!/bin/bash
# Stop the DragonflyDB HA cluster

set -e

echo "Stopping DragonflyDB HA cluster..."
docker-compose down

echo "DragonflyDB HA cluster stopped."

