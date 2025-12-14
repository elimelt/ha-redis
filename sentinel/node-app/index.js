const { createSentinel } = require('redis');


// Channel to use for pub/sub
const CHANNEL = 'test-channel';

// Sentinel instances
let subscriber = null;
let publisher = null;

// Sentinel configuration
const sentinelConfig = {
  name: 'mymaster',
  sentinelRootNodes: [
    { host: 'localhost', port: 26379 },
    { host: 'localhost', port: 26380 },
    { host: 'localhost', port: 26381 }
  ],
  nodeClientOptions: {
    socket: {
      reconnectStrategy: (retries) => {
        console.log(`[DEBUG] Reconnect attempt #${retries}`);
        if (retries > 3) {
          console.log('[DEBUG] Max reconnect attempts reached');
          return new Error('Max reconnect attempts reached');
        }
        return Math.min(retries * 100, 3000);
      }
    }
  }
};

// Initialize connections and set up pub/sub
async function initialize() {
  try {
    // Create and connect subscriber
    subscriber = createSentinel(sentinelConfig)
      .on('error', (err) => {
        console.error('✗ Subscriber error:', err);
        console.log('[DEBUG] Subscriber error type:', err.constructor.name);
      })
      .on('reconnecting', () => {
        console.log('🔄 Subscriber reconnecting...');
        logSubscriberInfo();
      })
      .on('ready', () => {
        console.log('✓ Subscriber ready');
        logSubscriberInfo();
      })
      .on('sentinel-error', (err) => {
        console.error('✗ Sentinel error (subscriber):', err);
      });

    await subscriber.connect();
    console.log('✓ Subscriber connected to Redis via Sentinel');
    await logSubscriberInfo();

    // Create and connect publisher
    publisher = createSentinel(sentinelConfig)
      .on('error', (err) => {
        console.error('✗ Publisher error:', err);
        console.log('[DEBUG] Publisher error type:', err.constructor.name);
      })
      .on('reconnecting', () => {
        console.log('🔄 Publisher reconnecting...');
        logPublisherInfo();
      })
      .on('ready', () => {
        console.log('✓ Publisher ready');
        logPublisherInfo();
      })
      .on('sentinel-error', (err) => {
        console.error('✗ Sentinel error (publisher):', err);
      });

    await publisher.connect();
    console.log('✓ Publisher connected to Redis via Sentinel');
    await logPublisherInfo();

    console.log('\n✓ Both clients connected successfully\n');

    // Subscribe to channel
    await subscriber.subscribe(CHANNEL, (message) => {
      console.log(`📨 Received message on channel "${CHANNEL}": ${message}`);
    });

    console.log(`✓ Subscribed to channel: ${CHANNEL}\n`);

    // Start publishing messages after subscription is confirmed
    startPublishing();
  } catch (err) {
    console.error('✗ Failed to initialize:', err);
    process.exit(1);
  }
}

async function logSubscriberInfo() {
  try {
    const info = await subscriber.info('replication');
    const lines = info.split('\n');
    const roleLine = lines.find(l => l.startsWith('role:'));
    if (roleLine) {
      console.log(`   [DEBUG] Subscriber role: ${roleLine.split(':')[1].trim()}`);
    }

    const clientInfo = await subscriber.clientInfo();
    if (clientInfo.laddr) {
      console.log(`   [DEBUG] Subscriber connected to: ${clientInfo.laddr}`);
    }
  } catch (e) {
    console.log(`   [DEBUG] Could not get subscriber info: ${e.message}`);
  }
}

async function logPublisherInfo() {
  try {
    const info = await publisher.info('replication');
    const lines = info.split('\n');
    const roleLine = lines.find(l => l.startsWith('role:'));
    if (roleLine) {
      console.log(`   [DEBUG] Publisher role: ${roleLine.split(':')[1].trim()}`);
    }

    const clientInfo = await publisher.clientInfo();
    if (clientInfo.laddr) {
      console.log(`   [DEBUG] Publisher connected to: ${clientInfo.laddr}`);
    }
  } catch (e) {
    console.log(`   [DEBUG] Could not get publisher info: ${e.message}`);
  }
}

// Publish messages periodically
let messageCount = 0;
let publishInterval;

function startPublishing() {
  console.log('--- Starting to publish messages every 2 seconds ---\n');

  // Log initial master info
  logPublisherInfo();

  publishInterval = setInterval(async () => {
    messageCount++;
    const message = `Hello from Sentinel! Message #${messageCount} at ${new Date().toISOString()}`;

    try {
      const numSubscribers = await publisher.publish(CHANNEL, message);
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 📤 Published message #${messageCount} (${numSubscribers} subscriber(s))`);

      // Log master info every 10 messages
      if (messageCount % 10 === 0) {
        await logPublisherInfo();
      }
    } catch (err) {
      console.error(`✗ Failed to publish message #${messageCount}:`, err.message);
      console.log(`   [DEBUG] Error type: ${err.constructor.name}`);
      // Try to get connection status
      try {
        const isOpen = publisher.isOpen;
        const isReady = publisher.isReady;
        console.log(`   [DEBUG] Publisher state - isOpen: ${isOpen}, isReady: ${isReady}`);
      } catch (e) {
        console.log(`   [DEBUG] Could not get publisher state`);
      }
    }
  }, 2000);
}

// Graceful shutdown
async function shutdown() {
  console.log('\n\n--- Shutting down gracefully ---');

  if (publishInterval) {
    clearInterval(publishInterval);
  }

  try {
    if (subscriber) {
      await subscriber.unsubscribe(CHANNEL);
      console.log('✓ Unsubscribed from channel');
      await subscriber.disconnect();
    }

    if (publisher) {
      await publisher.disconnect();
    }

    console.log('✓ Disconnected from Redis');
  } catch (err) {
    console.error('✗ Error during shutdown:', err);
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Query sentinel for current master info
async function querySentinelMaster() {
  const net = require('net');

  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: 'localhost', port: 26379 }, () => {
      client.write('*3\r\n$8\r\nSENTINEL\r\n$23\r\nget-master-addr-by-name\r\n$8\r\nmymaster\r\n');
    });

    let data = '';
    client.on('data', (chunk) => {
      data += chunk.toString();
      if (data.includes('\r\n')) {
        client.end();
        // Parse RESP array response
        const lines = data.split('\r\n');
        if (lines.length >= 5) {
          const host = lines[2];
          const port = lines[4];
          resolve({ host, port });
        } else {
          resolve({ host: 'unknown', port: 'unknown' });
        }
      }
    });

    client.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      client.end();
      reject(new Error('Timeout querying sentinel'));
    }, 5000);
  });
}

// Periodically log sentinel master info
setInterval(async () => {
  try {
    const master = await querySentinelMaster();
    console.log(`\n[DEBUG] Sentinel reports current master: ${master.host}:${master.port}\n`);
  } catch (err) {
    console.log(`\n[DEBUG] Failed to query sentinel: ${err.message}\n`);
  }
}, 15000);

// Start the application
console.log('=== Redis Sentinel Pub/Sub Test ===');
console.log(`Connecting to Sentinel at localhost:26379, 26380, 26381`);
console.log(`Master name: mymaster`);
console.log(`Channel: ${CHANNEL}\n`);

initialize();

