# Redis Sentinel Pub/Sub Test Client

A simple Node.js application to test Redis Sentinel with pub/sub functionality using the official `redis` (node-redis) client library.

## Prerequisites

- Node.js installed
- Redis Sentinel running on localhost:26379
- Redis master named "mymaster"

## Installation

```bash
cd node-app
npm install
```

## Usage

### Option 1: Basic GET/SET Test (Recommended for testing failover)

Run a simple test that performs GET/SET operations every 2 seconds:

```bash
npm run basic
```

This will:
- Connect to Redis via Sentinel
- Perform SET and GET operations every 2 seconds
- Show success/failure stats
- Log connection info periodically
- Display which Redis node is being used

**This is the best way to test failover behavior** - you can trigger a failover and see if operations continue successfully after reconnection.

### Option 2: Combined Publisher and Subscriber

Run a single script that both publishes and subscribes to messages:

```bash
npm start
```

This will:
- Connect to Redis via Sentinel
- Subscribe to the "test-channel"
- Publish a message every 2 seconds
- Display received messages

### Option 3: Separate Publisher and Subscriber

Run subscriber in one terminal:

```bash
npm run subscriber
# Or with custom channel:
node subscriber.js my-custom-channel
```

Run publisher in another terminal:

```bash
npm run publisher
# Or with custom channel:
node publisher.js my-custom-channel
# Or publish a single message:
node publisher.js my-custom-channel "Hello, World!"
```

## Configuration

The Sentinel configuration is in each script using the `createSentinel` API:

```javascript
const { createSentinel } = require('redis');

const sentinelConfig = {
  name: 'mymaster',
  sentinelRootNodes: [
    { host: 'localhost', port: 26379 }
  ]
};

const client = createSentinel(sentinelConfig);
await client.connect();
```

To add more Sentinel nodes for redundancy, add them to the `sentinelRootNodes` array:

```javascript
sentinelRootNodes: [
  { host: 'localhost', port: 26379 },
  { host: 'localhost', port: 26380 },
  { host: 'localhost', port: 26381 }
]
```

## Testing Failover

### Basic GET/SET Test (Recommended)

1. Start the basic test: `npm run basic`
2. Wait for a few successful operations
3. Trigger a failover in your Redis Sentinel setup (e.g., stop the current master)
4. Watch the output:
   - You should see reconnection attempts
   - The client should discover the new master
   - Operations should resume successfully
5. Check the success rate when you stop the test (Ctrl+C)

Example output during failover:
```
✓ SET test:key:10 = value-10-...
✓ GET test:key:10 = value-10-... (MATCH)
✗ Error: Connection closed
🔄 Reconnecting to Redis...
[DEBUG] Reconnect attempt #1
✓ Client ready
[DEBUG] Client role: master
[DEBUG] Connected to: 172.22.0.4:6379
✓ SET test:key:11 = value-11-...
✓ GET test:key:11 = value-11-... (MATCH)
```

### Pub/Sub Test

1. Start the subscriber: `npm run subscriber`
2. Start the publisher: `npm run publisher`
3. Trigger a failover in your Redis Sentinel setup
4. The clients should automatically reconnect to the new master
5. **Note:** Pub/Sub subscriptions may need to be re-established after failover

## Notes

- Uses the official `redis` (node-redis v4) client library with the `createSentinel` API
- The Sentinel client automatically discovers the current master from Sentinel
- Automatic reconnection and failover handling is built-in
- Separate Sentinel instances are used for publisher and subscriber (required for pub/sub)
- The client will automatically reconnect to the new master during failover

## Stopping

Press `Ctrl+C` to gracefully shutdown any running script.

