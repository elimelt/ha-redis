#!/bin/sh
# Redis Cluster Entrypoint Script
# This script starts a Redis node and initializes the cluster if needed

set -e

# Create config directory if it doesn't exist
mkdir -p /usr/local/etc/redis

# Replace CLUSTER_IP placeholder in config
sed "s/\${CLUSTER_IP}/${CLUSTER_IP}/g" /tmp/redis-cluster.conf > /usr/local/etc/redis/redis.conf

# Start Redis in the background
redis-server /usr/local/etc/redis/redis.conf &
REDIS_PID=$!

# Wait for Redis to be ready
echo "Waiting for Redis to start..."
sleep 2

# If this is node 1, wait for all nodes and create the cluster
if [ "$CLUSTER_IP" = "redis-node-1" ]; then
    echo "This is node 1, waiting for all nodes to be ready..."
    sleep 10

    # Check if cluster has slots assigned (means it's already initialized)
    SLOTS_ASSIGNED=$(redis-cli cluster info | grep "cluster_slots_assigned" | cut -d: -f2 | tr -d '\r')

    if [ "$SLOTS_ASSIGNED" != "0" ]; then
        echo "Cluster already has slots assigned ($SLOTS_ASSIGNED), skipping creation..."
    else
        echo "Creating Redis Cluster..."
        redis-cli --cluster create \
            redis-node-1:6379 \
            redis-node-2:6379 \
            redis-node-3:6379 \
            redis-node-4:6379 \
            redis-node-5:6379 \
            redis-node-6:6379 \
            --cluster-replicas 1 \
            --cluster-yes

        echo "Redis Cluster created successfully!"
    fi
fi

# Wait for Redis process
wait $REDIS_PID

