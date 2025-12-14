# Redis Sentinel with Synchronous Replication

This setup demonstrates Redis Sentinel with synchronous replication using the `min-replicas-to-write` and `min-replicas-max-lag` configuration options, based on the concepts discussed in [antirez's blog post](https://antirez.com/news/58).

## Overview

This configuration provides a middle ground between fully asynchronous replication and true synchronous replication:

- **3 Redis nodes**: 1 master + 2 replicas
- **3 Sentinels**: For automatic failover and monitoring
- **Synchronous replication settings**:
  - `min-replicas-to-write: 1` - Writes require acknowledgment from at least 1 replica
  - `min-replicas-max-lag: 10` - Replicas with lag > 10 seconds don't count

## How It Works

Based on antirez's article, Redis implements a weaker form of synchronous replication:

1. **REPLCONF ACK**: Replicas send acknowledgments back to the master with their replication offset
2. **Lag Detection**: Master tracks how far behind each replica is
3. **Write Rejection**: If not enough "healthy" replicas are available, writes are rejected
4. **No Rollbacks**: Unlike true synchronous replication, Redis doesn't rollback on timeout - it just rejects new writes

This provides stronger durability guarantees than async replication while maintaining Redis's simplicity (no rollback mechanism needed).

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Redis Primary  │────▶│  Redis Replica1 │     │  Redis Replica2 │
│   (port 6379)   │     │   (port 6380)   │     │   (port 6381)   │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │                       ▲                        ▲
         │                       │                        │
         └───────────────────────┴────────────────────────┘
                    REPLCONF ACK (offset)

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Sentinel 1    │     │   Sentinel 2    │     │   Sentinel 3    │
│  (port 26379)   │     │  (port 26380)   │     │  (port 26381)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         └───────────────────┬────────────────────────┘
                    Monitor "mymaster"
```

## Quick Start

### 1. Start the Cluster

```bash
cd sentinel-synchronous-replication
./s/start.sh
```

### 2. Check Status

```bash
./s/status.sh
```

### 3. Install Node.js Dependencies

```bash
cd node-app
npm install
```

### 4. Run Tests

```bash
# Basic connectivity test
npm run test:basic

# Test synchronous replication behavior
npm run test:sync-replication

# Monitor replica lag
npm run test:replica-lag

# Test failover behavior
npm run test:failover
```

## Test Scripts

### basic-test.js
Tests basic connectivity to the cluster via Sentinel and verifies the synchronous replication settings.

### test-sync-replication.js
Performs multiple writes and verifies that they are acknowledged by replicas according to the `min-replicas-to-write` setting.

### test-replica-lag.js
Monitors replica lag over time and shows how the `min-replicas-max-lag` setting affects write acceptance.

### test-failover.js
Continuously monitors the cluster and shows behavior during failover scenarios. Run this and then stop the primary with `docker stop redis-primary` to see automatic failover in action.

## Configuration Details

### Synchronous Replication Settings

In `config/redis.conf`:

```conf
# Require at least 1 replica to acknowledge writes
min-replicas-to-write 1

# Maximum lag allowed for replicas (in seconds)
min-replicas-max-lag 10
```

### What This Means

- Writes will be **rejected** if fewer than 1 replica is available with lag < 10 seconds
- This provides stronger durability than async replication
- Unlike true synchronous replication, there are no rollbacks - writes either succeed or are rejected
- The master tracks replica offsets via `REPLCONF ACK` messages sent by replicas

## Testing Scenarios

### Scenario 1: Normal Operation
With all replicas healthy, writes should succeed normally and be acknowledged by at least 1 replica.

### Scenario 2: Replica Failure
Stop one replica:
```bash
docker stop redis-replica-1
```
Writes should still succeed (we have 1 healthy replica remaining).

Stop both replicas:
```bash
docker stop redis-replica-1 redis-replica-2
```
Writes should now be **rejected** (not enough replicas).

### Scenario 3: Network Partition
Pause a replica to simulate network lag:
```bash
docker pause redis-replica-1
```
After 10 seconds, that replica won't count toward `min-replicas-to-write`.

### Scenario 4: Failover
Stop the primary:
```bash
docker stop redis-primary
```
Sentinel will promote a replica to master. The new master will also enforce the same synchronous replication settings.

## Stopping the Cluster

```bash
./s/stop.sh
```

## References

- [Exploring synchronous replication in Redis](https://antirez.com/news/58) by antirez
- [Redis Replication Documentation](https://redis.io/docs/management/replication/)
- [Redis Sentinel Documentation](https://redis.io/docs/management/sentinel/)
- [node-redis Documentation](https://github.com/redis/node-redis)

