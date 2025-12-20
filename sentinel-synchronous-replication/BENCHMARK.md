# Synchronous Replication in Redis: Theory, Implementation, and Benchmarks

Redis is often described as an "eventually consistent" system, but with the right configuration, you can achieve **quasi-synchronous replication** that provides strong durability guarantees without sacrificing Redis's legendary performance. This post explores the theory behind Redis's synchronous replication, demonstrates a production-ready implementation, and presents comprehensive benchmarks.

## The Theory: Why "Quasi-Synchronous"?

Traditional synchronous replication requires a write to be acknowledged by replicas *before* returning success to the client. Redis takes a different approach, as [Salvatore Sanfilippo (antirez) explained](https://antirez.com/news/58):

> "Redis uses asynchronous replication... However there is a way to greatly improve the situation using the WAIT command."

Redis's model is "quasi-synchronous" because:

1. **No rollbacks**: If a write succeeds on the master but fails to replicate, Redis doesn't roll it back. Instead, it *rejects new writes* until replicas catch up.
2. **Lag-based detection**: Replicas are considered "good" if they've acknowledged data within `min-replicas-max-lag` seconds.
3. **Explicit synchronization**: The `WAIT` command blocks until N replicas acknowledge the current replication offset.

This design trades theoretical consistency for practical durability—you get strong guarantees without the complexity of distributed consensus.

## The Implementation

Our setup uses **Redis Sentinel** for automatic failover with synchronous replication guarantees:

```
┌─────────────────────────────────────────────────────────────┐
│                     Redis Cluster                           │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐               │
│  │ Primary │────▶│Replica 1│     │Replica 2│               │
│  │  :6379  │────▶│  :6380  │     │  :6381  │               │
│  └─────────┘     └─────────┘     └─────────┘               │
│       │               │               │                     │
│  ┌────┴───────────────┴───────────────┴────┐               │
│  │           Sentinel Cluster              │               │
│  │   :26379      :26380      :26381        │               │
│  └─────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### Key Configuration

```conf
# redis.conf - Synchronous replication settings
min-replicas-to-write 1      # Require at least 1 replica for writes
min-replicas-max-lag 10      # Replica must ACK within 10 seconds
```

These settings ensure the master **rejects writes** if no replica has acknowledged data within the lag window. This is the foundation of Redis's durability guarantee.

## Benchmark Results

All benchmarks run on a local Docker setup (3 Redis nodes, 3 Sentinels) using Node.js with the `redis` package.

### Async vs Synchronous Writes

| Mode | Throughput | p50 | p99 | p99.9 |
|------|------------|-----|-----|-------|
| Async (no WAIT) | 35,170 ops/s | 0.025ms | 0.079ms | 0.256ms |
| WAIT 1 replica | 16,265 ops/s | 0.055ms | 0.123ms | 0.333ms |
| WAIT 2 replicas | 15,876 ops/s | 0.056ms | 0.124ms | 0.286ms |

**Key insight**: The `WAIT` command adds ~50% overhead for individual operations. But there's a better way...

### The Pipeline + WAIT Optimization

Instead of calling `WAIT` after every write, batch writes with a single `WAIT` at the end:

| Pipeline Size | No WAIT | WAIT 1 | WAIT 2 |
|---------------|---------|--------|--------|
| 1 | 25,182 ops/s | 13,781 ops/s | 15,443 ops/s |
| 10 | 198,535 ops/s | 121,412 ops/s | 121,640 ops/s |
| 50 | 401,598 ops/s | 332,869 ops/s | 310,168 ops/s |
| 100 | 474,328 ops/s | **392,149 ops/s** | 380,334 ops/s |

**This is the key optimization**: With 100-command pipelines, you get **392k ops/sec with synchronous replication**—only 17% slower than fully async writes.

### Concurrent Connections

| Clients | Aggregate Throughput | p50 | p99 |
|---------|---------------------|-----|-----|
| 1 | 36,098 ops/s | 0.024ms | 0.053ms |
| 10 | 118,016 ops/s | 0.067ms | 0.233ms |
| 50 | 156,508 ops/s | 0.319ms | 0.520ms |
| 100 | 156,204 ops/s | 0.500ms | 1.166ms |

Throughput plateaus around 50 concurrent connections on this hardware.

### Read-After-Write Consistency

| Metric | Result |
|--------|--------|
| Immediately consistent | 100% |
| Required WAIT | 0% |
| Failed | 0% |

In our local setup, replication is fast enough that reads from replicas immediately see the latest data.

## Failure Scenarios

### Scenario 1: Both Replicas Paused (Network Partition)

When both replicas are paused, simulating a network partition:

- **Writes during partition**: 81.19% success rate
- **Failed writes**: 120 operations with `NOREPLICAS Not enough good replicas to write`
- **Recovery**: Automatic once replicas reconnect

The system correctly **rejects writes** when no replicas are available, preventing data loss.

### Scenario 2: Replica Stop/Start

When one replica is stopped and restarted:

- **Writes during failure**: 100% success rate
- **Replica transitions**: 2 → 1 → 2 replicas
- **No data loss**: All writes preserved

With `min-replicas-to-write: 1`, the system remains available as long as one replica is healthy.

## Configuration Recommendations

Based on our benchmarks:

1. **Use `min-replicas-to-write: 1`** for availability with durability
2. **Use `min-replicas-max-lag: 10`** as a reasonable default (adjust based on your network)
3. **Batch writes with pipelines** and call `WAIT` once per batch
4. **Use 10-50 concurrent connections** for optimal throughput
5. **Monitor replica lag** to detect replication issues before they cause write rejections

## Conclusion

Redis's quasi-synchronous replication provides a practical middle ground between pure async replication and full distributed consensus. With the right configuration and the **pipeline + WAIT** pattern, you can achieve:

- **392k ops/sec** with synchronous replication guarantees
- **Automatic write rejection** when replicas are unavailable
- **Zero data loss** during controlled failovers
- **100% read-after-write consistency** in typical conditions

The key is understanding that `min-replicas-to-write` protects against split-brain scenarios, while `WAIT` provides explicit synchronization for critical writes. Used together with pipelining, you get the best of both worlds: Redis's speed with strong durability guarantees.

---

## Appendix: Running the Benchmarks

```bash
# Start the cluster
cd sentinel-synchronous-replication
./s/start.sh

# Run benchmarks
cd node-app
npm install
npm run benchmark              # Main benchmark suite
npm run benchmark:config-sweep # Configuration comparison
npm run benchmark:failure      # Failure scenario tests
```

The complete implementation is available in the `sentinel-synchronous-replication` directory.

