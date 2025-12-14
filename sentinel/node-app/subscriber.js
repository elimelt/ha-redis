const { createSentinel } = require('redis');

// Channel to subscribe to
const CHANNEL = process.argv[2] || 'test-channel';

// Sentinel instance
let subscriber = null;

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

// Initialize connection and subscribe
async function initialize() {
  try {
    subscriber = createSentinel(sentinelConfig)
      .on('error', (err) => {
        console.error('✗ Error:', err);
        console.log('[DEBUG] Error type:', err.constructor.name);
      })
      .on('reconnecting', () => {
        console.log('🔄 Reconnecting to Redis...');
        logConnectionInfo();
      })
      .on('ready', () => {
        console.log('✓ Subscriber ready');
        logConnectionInfo();
      })
      .on('sentinel-error', (err) => {
        console.error('✗ Sentinel error:', err);
      });

    await subscriber.connect();
    console.log('✓ Connected to Redis via Sentinel');

    // Get connection info
    await logConnectionInfo();

    await subscriber.subscribe(CHANNEL, (message) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 📨 Channel "${CHANNEL}": ${message}`);
    });

    console.log(`✓ Subscribed to channel: ${CHANNEL}`);
    console.log('Waiting for messages... (Press Ctrl+C to exit)\n');
  } catch (err) {
    console.error('✗ Failed to initialize:', err);
    process.exit(1);
  }
}

async function logConnectionInfo() {
  try {
    const info = await subscriber.info('replication');
    const lines = info.split('\n');
    const roleLine = lines.find(l => l.startsWith('role:'));
    const masterHostLine = lines.find(l => l.startsWith('master_host:'));
    const masterPortLine = lines.find(l => l.startsWith('master_port:'));

    if (roleLine) {
      const role = roleLine.split(':')[1].trim();
      console.log(`   [DEBUG] Subscriber role: ${role}`);

      if (role === 'slave' && masterHostLine && masterPortLine) {
        const masterHost = masterHostLine.split(':')[1].trim();
        const masterPort = masterPortLine.split(':')[1].trim();
        console.log(`   [DEBUG] Replicating from: ${masterHost}:${masterPort}`);
      }
    }

    const clientInfo = await subscriber.clientInfo();
    if (clientInfo.laddr) {
      console.log(`   [DEBUG] Connected to: ${clientInfo.laddr}`);
    }
  } catch (e) {
    console.log(`   [DEBUG] Could not get connection info: ${e.message}`);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('\n\n--- Shutting down ---');

  try {
    if (subscriber) {
      await subscriber.unsubscribe(CHANNEL);
      console.log('✓ Unsubscribed from channel');
      await subscriber.disconnect();
      console.log('✓ Disconnected from Redis');
    }
  } catch (err) {
    console.error('✗ Error during shutdown:', err);
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('=== Redis Sentinel Subscriber ===');
console.log(`Sentinel: localhost:26379`);
console.log(`Master: mymaster`);
console.log(`Channel: ${CHANNEL}\n`);

initialize();

