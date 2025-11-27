#!/bin/bash
# Add a new replica to the cluster

set -e

REPLICA_NAME=${1:-redis-replica-3}
REPLICA_PORT=${2:-6382}

echo "=== Adding new replica: $REPLICA_NAME ==="
echo ""

# Check if replica already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${REPLICA_NAME}$"; then
    echo "Error: Container $REPLICA_NAME already exists"
    echo "Remove it first with: docker rm -f $REPLICA_NAME"
    exit 1
fi

echo "Getting current master..."
MASTER_INFO=$(docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster)
MASTER_IP=$(echo $MASTER_INFO | awk '{print $1}')
MASTER_PORT=$(echo $MASTER_INFO | awk '{print $2}')

echo "Current master: $MASTER_IP:$MASTER_PORT"
echo ""

echo "Starting new replica container..."
docker run -d \
    --name $REPLICA_NAME \
    --network ha-redis_redis-network \
    -p ${REPLICA_PORT}:6379 \
    -v $(pwd)/config/redis-replica.conf:/usr/local/etc/redis/redis.conf \
    redis:7-alpine \
    redis-server /usr/local/etc/redis/redis.conf

echo ""
echo "Waiting for replica to start..."
sleep 5

echo ""
echo "Replica status:"
docker exec $REPLICA_NAME redis-cli INFO replication | grep -E "role|master_host|master_link_status"

echo ""
echo "=== New replica added successfully ==="
echo "Replica name: $REPLICA_NAME"
echo "Replica port: $REPLICA_PORT"
echo ""
echo "Sentinel will automatically discover this replica."
echo "Check with: docker exec redis-sentinel-1 redis-cli -p 26379 SENTINEL replicas mymaster"

