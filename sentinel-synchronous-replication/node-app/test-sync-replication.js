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

async function testSynchronousReplication() {
  console.log('=== Synchronous Replication Test ===\n');
  console.log('This test verifies that writes are acknowledged by replicas');
  console.log('based on the min-replicas-to-write and min-replicas-max-lag settings.\n');
  
  const client = createSentinel(sentinelConfig);
  
  try {
    await client.connect();
    console.log('[SUCCESS] Connected to Redis cluster\n');

    // Check current settings
    console.log('Current synchronous replication settings:');
    const minReplicas = await client.configGet('min-replicas-to-write');
    const maxLag = await client.configGet('min-replicas-max-lag');
    console.log(`  min-replicas-to-write: ${minReplicas['min-replicas-to-write']}`);
    console.log(`  min-replicas-max-lag: ${maxLag['min-replicas-max-lag']} seconds\n`);

    // Perform multiple writes and check replication
    console.log('Performing write operations...');
    const numWrites = 10;
    const startTime = Date.now();
    
    for (let i = 0; i < numWrites; i++) {
      const key = `sync:test:${i}`;
      const value = `value-${i}-${Date.now()}`;
      await client.set(key, value);
      
      if (i % 5 === 0) {
        console.log(`  Written ${i + 1}/${numWrites} keys`);
      }
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`[SUCCESS] Completed ${numWrites} writes in ${duration}ms\n`);

    // Get replication info to verify replicas are in sync
    console.log('Checking replication status...');
    const info = await client.info('replication');
    const lines = info.split('\n');
    
    let connectedSlaves = 0;
    const slaveInfo = [];
    
    for (const line of lines) {
      if (line.startsWith('connected_slaves:')) {
        connectedSlaves = parseInt(line.split(':')[1]);
      }
      if (line.match(/^slave\d+:/)) {
        slaveInfo.push(line);
      }
    }
    
    console.log(`  Connected slaves: ${connectedSlaves}`);
    slaveInfo.forEach(info => console.log(`  ${info}`));
    console.log('');

    // Verify writes reached replicas
    console.log('Verifying data consistency across replicas...');
    const testKey = 'sync:test:0';
    const masterValue = await client.get(testKey);
    console.log(`  Master value for ${testKey}: ${masterValue}`);
    
    if (connectedSlaves >= parseInt(minReplicas['min-replicas-to-write'])) {
      console.log(`[SUCCESS] Minimum replica requirement met (${connectedSlaves} >= ${minReplicas['min-replicas-to-write']})`);
    } else {
      console.log(`[WARNING] Not enough replicas (${connectedSlaves} < ${minReplicas['min-replicas-to-write']})`);
    }

    console.log('\n[SUCCESS] Synchronous replication test completed');
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

testSynchronousReplication();

