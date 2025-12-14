const { createSentinel } = require('redis');

// Channel and message from command line args
const CHANNEL = process.argv[2] || 'test-channel';
const MESSAGE = process.argv[3];

// Sentinel instance
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

// Initialize connection
async function initialize() {
  try {
    publisher = createSentinel(sentinelConfig)
      .on('error', (err) => {
        console.error('✗ Error:', err);
        console.log('[DEBUG] Error type:', err.constructor.name);
      })
      .on('reconnecting', () => {
        console.log('🔄 Reconnecting to Redis...');
        logConnectionInfo();
      })
      .on('ready', () => {
        console.log('✓ Publisher ready');
        logConnectionInfo();
      })
      .on('sentinel-error', (err) => {
        console.error('✗ Sentinel error:', err);
      });

    await publisher.connect();
    console.log('✓ Connected to Redis via Sentinel');

    // Get connection info
    await logConnectionInfo();
    console.log('');

    if (MESSAGE) {
      // Publish single message and exit
      await publishMessage(MESSAGE);
      await publisher.disconnect();
      process.exit(0);
    } else {
      // Start publishing messages periodically
      startPeriodicPublishing();
    }
  } catch (err) {
    console.error('✗ Failed to initialize:', err);
    process.exit(1);
  }
}

async function logConnectionInfo() {
  try {
    const info = await publisher.info('replication');
    const lines = info.split('\n');
    const roleLine = lines.find(l => l.startsWith('role:'));

    if (roleLine) {
      const role = roleLine.split(':')[1].trim();
      console.log(`   [DEBUG] Publisher role: ${role}`);
    }

    const clientInfo = await publisher.clientInfo();
    if (clientInfo.laddr) {
      console.log(`   [DEBUG] Connected to: ${clientInfo.laddr}`);
    }
  } catch (e) {
    console.log(`   [DEBUG] Could not get connection info: ${e.message}`);
  }
}

// Publish a single message
async function publishMessage(message) {
  try {
    const timestamp = new Date().toISOString();
    const numSubscribers = await publisher.publish(CHANNEL, message);
    console.log(`[${timestamp}] 📤 Published to channel "${CHANNEL}": ${message}`);
    console.log(`   Received by ${numSubscribers} subscriber(s)`);
    await logConnectionInfo();
  } catch (err) {
    console.error('✗ Failed to publish:', err.message);
    try {
      const isOpen = publisher.isOpen;
      const isReady = publisher.isReady;
      console.log(`   [DEBUG] Publisher state - isOpen: ${isOpen}, isReady: ${isReady}`);
    } catch (e) {
      console.log(`   [DEBUG] Could not get publisher state`);
    }
  }
}

// Publish messages periodically
let messageCount = 0;
let publishInterval;

function startPeriodicPublishing() {
  console.log('--- Publishing messages every 2 seconds (Press Ctrl+C to exit) ---\n');

  publishInterval = setInterval(async () => {
    messageCount++;
    const timestamp = new Date().toISOString();
    const message = `Message #${messageCount} at ${timestamp}`;

    try {
      const numSubscribers = await publisher.publish(CHANNEL, message);
      console.log(`[${timestamp}] 📤 [${messageCount}] Published (${numSubscribers} subscriber(s)): ${message}`);

      // Log connection info every 10 messages
      if (messageCount % 10 === 0) {
        await logConnectionInfo();
      }
    } catch (err) {
      console.error(`✗ Failed to publish message #${messageCount}:`, err.message);
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
  console.log('\n\n--- Shutting down ---');

  if (publishInterval) {
    clearInterval(publishInterval);
  }

  try {
    if (publisher) {
      await publisher.disconnect();
      console.log('✓ Disconnected from Redis');
    }
  } catch (err) {
    console.error('✗ Error during shutdown:', err);
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('=== Redis Sentinel Publisher ===');
console.log(`Sentinel: localhost:26379`);
console.log(`Master: mymaster`);
console.log(`Channel: ${CHANNEL}\n`);

initialize();

