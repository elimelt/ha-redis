#!/bin/sh
# Sentinel entrypoint script that waits for Redis primary and resolves its IP

set -e

echo "Waiting for Redis primary to be available..."

# Wait for redis-primary to be resolvable and get its IP
max_attempts=30
attempt=0
REDIS_PRIMARY_IP=""

while [ $attempt -lt $max_attempts ]; do
    REDIS_PRIMARY_IP=$(getent hosts redis-primary 2>/dev/null | awk '{ print $1 }' | head -n1)
    if [ -n "$REDIS_PRIMARY_IP" ]; then
        echo "Redis primary resolved to IP: $REDIS_PRIMARY_IP"
        # Check if Redis is actually responding
        if nc -z $REDIS_PRIMARY_IP 6379 2>/dev/null; then
            echo "Redis primary is reachable on port 6379!"
            break
        fi
    fi
    attempt=$((attempt + 1))
    echo "Attempt $attempt/$max_attempts: Waiting for redis-primary..."
    sleep 1
done

if [ $attempt -eq $max_attempts ]; then
    echo "ERROR: Could not reach redis-primary after $max_attempts attempts"
    exit 1
fi

# Copy sentinel config to writable location and replace hostname with IP
cp /tmp/sentinel.conf /data/sentinel.conf
sed -i "s/redis-primary/$REDIS_PRIMARY_IP/g" /data/sentinel.conf
chmod 666 /data/sentinel.conf

echo "Starting Sentinel with master at $REDIS_PRIMARY_IP:6379"

# Start sentinel
exec redis-sentinel /data/sentinel.conf

