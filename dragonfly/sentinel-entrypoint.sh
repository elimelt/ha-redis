#!/bin/sh
set -e

# Wait for dragonfly-primary to be resolvable
echo "Waiting for dragonfly-primary to be resolvable..."
until getent hosts dragonfly-primary > /dev/null 2>&1; do
    echo "Waiting for dragonfly-primary DNS..."
    sleep 1
done

echo "dragonfly-primary is resolvable, starting sentinel..."

# Get the IP address of dragonfly-primary
PRIMARY_IP=$(getent hosts dragonfly-primary | awk '{ print $1 }')
echo "dragonfly-primary IP: $PRIMARY_IP"

# Create directory and sentinel config with IP address
mkdir -p /etc/redis
cat > /etc/redis/sentinel.conf << EOF
port 26379
dir /tmp
sentinel monitor dragonfly-master $PRIMARY_IP 6379 2
sentinel down-after-milliseconds dragonfly-master 5000
sentinel parallel-syncs dragonfly-master 1
sentinel failover-timeout dragonfly-master 10000
sentinel deny-scripts-reconfig yes
EOF

# Start sentinel
exec redis-sentinel /etc/redis/sentinel.conf

