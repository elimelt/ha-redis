# High Availability Redis Configurations

Three different Redis high-availability setups with Docker Compose

## Setups

### 1. Sentinel (`/sentinel`)
Redis Sentinel for automatic failover with 1 primary, 2 replicas, and 3 sentinels.

```bash
cd sentinel
./s/start.sh
```

### 2. Cluster (`/cluster`)
Redis Cluster with 6 nodes (3 primaries, 3 replicas) for horizontal scaling.

```bash
cd cluster
./s/start.sh
```

### 3. Dragonfly (`/dragonfly`)
Dragonfly DB with primary-replica replication (Redis-compatible alternative).

```bash
cd dragonfly
./s/start.sh
```
## Usage

Each directory contains:
- `docker-compose.yaml` - Service definitions
- `s/` - Scripts for start, stop, status, monitoring, and failover testing
- `app/` - Go application for testing

