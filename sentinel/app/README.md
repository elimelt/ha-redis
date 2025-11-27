# Redis HA Express Application

An Express.js application that connects to a Redis High Availability cluster using Sentinel and provides HTTP endpoints for various Redis operations.

## Features

- **Sentinel Support**: Automatically connects to Redis master/slave through Sentinel
- **Automatic Failover**: Handles Redis failover gracefully
- **Read/Write Separation**: Reads from slaves, writes to master
- **Multiple Operations**: Support for various Redis data types (strings, lists, sets, hashes)
- **Load Generation**: Built-in endpoint for generating mixed workloads
- **Statistics Tracking**: Real-time statistics on operations

## API Endpoints

### Health & Monitoring

- `GET /health` - Check if the application can connect to Redis
- `GET /stats` - View operation statistics
- `POST /stats/reset` - Reset statistics counters

### Write Operations

All write operations accept optional parameters in the request body.

- `POST /set` - SET operation
  ```json
  {
    "key": "mykey",
    "value": "myvalue",
    "ttl": 300
  }
  ```

- `POST /incr` - INCR operation
  ```json
  {
    "key": "counter:1"
  }
  ```

- `POST /lpush` - LPUSH operation
  ```json
  {
    "key": "list:1",
    "value": "item"
  }
  ```

- `POST /sadd` - SADD operation
  ```json
  {
    "key": "set:1",
    "value": "member"
  }
  ```

- `POST /hset` - HSET operation
  ```json
  {
    "key": "hash:1",
    "field": "field1",
    "value": "value1"
  }
  ```

### Read Operations

- `GET /get/:key?` - GET operation (key is optional)
- `GET /exists/:key?` - EXISTS operation
- `GET /lrange/:key?` - LRANGE operation (supports ?start=0&stop=10)
- `GET /smembers/:key?` - SMEMBERS operation
- `GET /hgetall/:key?` - HGETALL operation

### Load Generation

- `POST /load` - Generate mixed load
  ```json
  {
    "operations": 1000,
    "readWriteRatio": 70
  }
  ```

## Usage Examples

### Using curl

```bash
# Health check
curl http://localhost:3000/health

# Set a value
curl -X POST http://localhost:3000/set \
  -H "Content-Type: application/json" \
  -d '{"key": "test", "value": "hello"}'

# Get a value
curl http://localhost:3000/get/test

# Generate load (1000 operations, 70% reads)
curl -X POST http://localhost:3000/load \
  -H "Content-Type: application/json" \
  -d '{"operations": 1000, "readWriteRatio": 70}'

# View statistics
curl http://localhost:3000/stats
```

### Using JavaScript/fetch

```javascript
// Set a value
fetch('http://localhost:3000/set', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'mykey', value: 'myvalue' })
})
  .then(res => res.json())
  .then(data => console.log(data));

// Get a value
fetch('http://localhost:3000/get/mykey')
  .then(res => res.json())
  .then(data => console.log(data));

// Generate load
fetch('http://localhost:3000/load', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ operations: 100, readWriteRatio: 70 })
})
  .then(res => res.json())
  .then(data => console.log(data));
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `REDIS_SENTINELS` - Comma-separated list of sentinel addresses (default: redis-sentinel-1:26379)
- `REDIS_MASTER_NAME` - Redis master name (default: mymaster)

## Running Locally

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or use nodemon for development
npm run dev
```

## Running with Docker

```bash
# Build the image
docker build -t redis-ha-express .

# Run the container
docker run -p 3000:3000 \
  -e REDIS_SENTINELS=redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379 \
  -e REDIS_MASTER_NAME=mymaster \
  redis-ha-express
```

## Testing Failover

1. Generate some load:
   ```bash
   curl -X POST http://localhost:3000/load \
     -H "Content-Type: application/json" \
     -d '{"operations": 10000, "readWriteRatio": 70}'
   ```

2. In another terminal, trigger a failover:
   ```bash
   docker stop redis-primary
   ```

3. The application will automatically reconnect to the new master

4. Check statistics to see the impact:
   ```bash
   curl http://localhost:3000/stats
   ```

