const { createSentinel } = require('redis');

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

async function runBasicTest() {
  console.log('=== Basic Sentinel Connection Test ===\n');
  
  const client = createSentinel(sentinelConfig);
  
  client.on('error', (err) => {
    console.error('[ERROR]', err);
  });

  client.on('connect', () => {
    console.log('[INFO] Connected to Redis via Sentinel');
  });

  client.on('ready', () => {
    console.log('[INFO] Client is ready');
  });

  try {
    await client.connect();
    console.log('[SUCCESS] Connected to Redis cluster\n');

    // Test basic operations
    console.log('Testing basic SET/GET operations...');
    await client.set('test:key', 'test-value');
    const value = await client.get('test:key');
    console.log(`[SUCCESS] SET/GET test passed: ${value}\n`);

    // Get replication info
    console.log('Getting replication info from master...');
    const info = await client.info('replication');
    console.log(info);
    console.log('');

    // Get config for synchronous replication
    console.log('Checking synchronous replication settings...');
    const minReplicas = await client.configGet('min-replicas-to-write');
    const maxLag = await client.configGet('min-replicas-max-lag');
    console.log(`min-replicas-to-write: ${minReplicas['min-replicas-to-write']}`);
    console.log(`min-replicas-max-lag: ${maxLag['min-replicas-max-lag']}`);
    console.log('');

    console.log('\n[SUCCESS] Basic test completed successfully');
  } catch (err) {
    console.error('[ERROR] Test failed:', err);
    process.exit(1);
  } finally {
    // Note: createSentinel client doesn't have disconnect/quit methods in v5
    // The connection will be cleaned up when the process exits
    console.log('[INFO] Test complete');
    process.exit(0);
  }
}

runBasicTest();

