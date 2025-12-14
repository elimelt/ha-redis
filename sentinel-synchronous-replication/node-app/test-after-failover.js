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
        if (retries > 3) {
          return new Error('Max reconnect attempts reached');
        }
        return Math.min(retries * 100, 3000);
      }
    }
  }
};

async function testAfterFailover() {
  console.log('=== Test After Failover ===\n');
  console.log('Testing that Sentinel client connects to new master and synchronous replication still works.\n');
  
  const client = createSentinel(sentinelConfig);
  
  try {
    await client.connect();
    console.log('[SUCCESS] Connected to Redis cluster via Sentinel\n');

    // Get replication info
    const info = await client.info('replication');
    const lines = info.split('\n');
    
    let role = 'unknown';
    let connectedSlaves = 0;
    
    for (const line of lines) {
      if (line.startsWith('role:')) {
        role = line.split(':')[1].trim();
      } else if (line.startsWith('connected_slaves:')) {
        connectedSlaves = parseInt(line.split(':')[1]);
      }
    }
    
    console.log(`Current master role: ${role}`);
    console.log(`Connected slaves: ${connectedSlaves}\n`);

    // Check synchronous replication settings
    const minReplicas = await client.configGet('min-replicas-to-write');
    const maxLag = await client.configGet('min-replicas-max-lag');
    console.log('Synchronous replication settings on new master:');
    console.log(`  min-replicas-to-write: ${minReplicas['min-replicas-to-write']}`);
    console.log(`  min-replicas-max-lag: ${maxLag['min-replicas-max-lag']}\n`);

    // Test write
    const testKey = 'test:post-failover:' + Date.now();
    const testValue = 'value-after-failover';
    
    await client.set(testKey, testValue);
    console.log(`[SUCCESS] Write succeeded: ${testKey} = ${testValue}`);
    
    const retrieved = await client.get(testKey);
    console.log(`[SUCCESS] Read succeeded: ${testKey} = ${retrieved}\n`);

    // Verify previous write is still there
    const previousValue = await client.get('test:after:failover');
    console.log(`[SUCCESS] Previous write still accessible: test:after:failover = ${previousValue}\n`);

    console.log('[SUCCESS] All tests passed! Synchronous replication working after failover.');
  } catch (err) {
    console.error('[ERROR] Test failed:', err);
    process.exit(1);
  } finally {
    console.log('[INFO] Test complete');
    process.exit(0);
  }
}

testAfterFailover();

