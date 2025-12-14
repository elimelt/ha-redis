const { createSentinel, createClient } = require('redis');

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

async function parseReplicationInfo(info) {
  const lines = info.split('\n');
  const result = {
    role: '',
    connectedSlaves: 0,
    masterReplOffset: 0,
    slaves: []
  };
  
  for (const line of lines) {
    if (line.startsWith('role:')) {
      result.role = line.split(':')[1].trim();
    } else if (line.startsWith('connected_slaves:')) {
      result.connectedSlaves = parseInt(line.split(':')[1]);
    } else if (line.startsWith('master_repl_offset:')) {
      result.masterReplOffset = parseInt(line.split(':')[1]);
    } else if (line.match(/^slave\d+:/)) {
      // Parse slave info: ip=127.0.0.1,port=6380,state=online,offset=123,lag=0
      const parts = line.split(':')[1].split(',');
      const slaveData = {};
      parts.forEach(part => {
        const [key, value] = part.split('=');
        slaveData[key] = value;
      });
      result.slaves.push(slaveData);
    }
  }
  
  return result;
}

async function testReplicaLag() {
  console.log('=== Replica Lag Test ===\n');
  console.log('This test monitors replica lag and verifies the min-replicas-max-lag setting.\n');
  
  const client = createSentinel(sentinelConfig);
  
  try {
    await client.connect();
    console.log('[SUCCESS] Connected to Redis cluster\n');

    // Check settings
    const minReplicas = await client.configGet('min-replicas-to-write');
    const maxLag = await client.configGet('min-replicas-max-lag');
    console.log('Synchronous replication settings:');
    console.log(`  min-replicas-to-write: ${minReplicas['min-replicas-to-write']}`);
    console.log(`  min-replicas-max-lag: ${maxLag['min-replicas-max-lag']} seconds\n`);

    // Monitor replication for several iterations
    console.log('Monitoring replica lag (5 iterations)...\n');
    
    for (let i = 0; i < 5; i++) {
      // Write some data
      const key = `lag:test:${i}:${Date.now()}`;
      await client.set(key, `value-${i}`);
      
      // Get replication info
      const info = await client.info('replication');
      const replInfo = await parseReplicationInfo(info);
      
      console.log(`Iteration ${i + 1}:`);
      console.log(`  Master offset: ${replInfo.masterReplOffset}`);
      console.log(`  Connected slaves: ${replInfo.connectedSlaves}`);
      
      if (replInfo.slaves.length > 0) {
        replInfo.slaves.forEach((slave, idx) => {
          const offset = parseInt(slave.offset);
          const lag = parseInt(slave.lag);
          const offsetDiff = replInfo.masterReplOffset - offset;
          
          console.log(`  Slave ${idx + 1} (${slave.ip}:${slave.port}):`);
          console.log(`    State: ${slave.state}`);
          console.log(`    Offset: ${offset} (diff: ${offsetDiff})`);
          console.log(`    Lag: ${lag} seconds`);
          
          if (lag > parseInt(maxLag['min-replicas-max-lag'])) {
            console.log(`    [WARNING] Lag exceeds max-lag threshold!`);
          }
        });
      }
      console.log('');
      
      // Wait before next iteration
      if (i < 4) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Test what happens when we try to write with insufficient replicas
    console.log('Testing write behavior with replica requirements...');
    const testKey = 'final:test:key';
    const testValue = 'final-value';
    
    try {
      await client.set(testKey, testValue);
      console.log(`[SUCCESS] Write succeeded: ${testKey} = ${testValue}`);
      
      const info = await client.info('replication');
      const replInfo = await parseReplicationInfo(info);
      
      const healthyReplicas = replInfo.slaves.filter(s => 
        s.state === 'online' && parseInt(s.lag) <= parseInt(maxLag['min-replicas-max-lag'])
      ).length;
      
      console.log(`  Healthy replicas (lag <= ${maxLag['min-replicas-max-lag']}s): ${healthyReplicas}`);
      console.log(`  Required replicas: ${minReplicas['min-replicas-to-write']}`);
      
      if (healthyReplicas >= parseInt(minReplicas['min-replicas-to-write'])) {
        console.log(`  [SUCCESS] Write met synchronous replication requirements`);
      } else {
        console.log(`  [WARNING] Write succeeded but may not have met requirements`);
      }
    } catch (err) {
      console.log(`[ERROR] Write failed: ${err.message}`);
      console.log('  This could mean insufficient replicas are available');
    }

    console.log('\n[SUCCESS] Replica lag test completed');
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

testReplicaLag();

