#!/bin/sh
# Sentinel Entrypoint Script
# This script resolves the redis-primary hostname to an IP and starts sentinel

set -e

echo "Resolving redis-primary hostname..."

# Wait for redis-primary to be resolvable
max_attempts=30
attempt=0
while ! getent hosts redis-primary > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ $attempt -ge $max_attempts ]; then
        echo "ERROR: Could not resolve redis-primary after $max_attempts attempts"
        exit 1
    fi
    echo "Waiting for redis-primary to be resolvable (attempt $attempt/$max_attempts)..."
    sleep 1
done

# Get the IP address of redis-primary
REDIS_PRIMARY_IP=$(getent hosts redis-primary | awk '{ print $1 }')
echo "redis-primary resolved to: $REDIS_PRIMARY_IP"

# Wait for redis-primary to be ready
attempt=0
while ! redis-cli -h $REDIS_PRIMARY_IP -p 6379 ping > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ $attempt -ge $max_attempts ]; then
        echo "ERROR: Could not reach redis-primary after $max_attempts attempts"
        exit 1
    fi
    echo "Waiting for redis-primary to be ready (attempt $attempt/$max_attempts)..."
    sleep 1
done

echo "redis-primary is ready!"

# Copy sentinel config to writable location and replace hostname with IP
cp /tmp/sentinel.conf /data/sentinel.conf
sed -i "s/redis-primary/$REDIS_PRIMARY_IP/g" /data/sentinel.conf
chmod 666 /data/sentinel.conf

echo "Starting Sentinel with master at $REDIS_PRIMARY_IP:6379"

# Start sentinel
exec redis-sentinel /data/sentinel.conf

