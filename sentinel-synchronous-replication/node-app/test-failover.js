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
        if (retries > 10) {
          return new Error('Max reconnect attempts reached');
        }
        return Math.min(retries * 500, 3000);
      }
    }
  }
};

async function testFailover() {
  console.log('=== Failover Test with Synchronous Replication ===\n');
  console.log('This test monitors the cluster during a failover scenario.');
  console.log('To trigger a failover, run: docker stop redis-primary\n');
  
  const client = createSentinel(sentinelConfig);
  
  let reconnectCount = 0;
  let lastMaster = null;
  
  client.on('error', (err) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${err.message}`);
  });

  client.on('connect', () => {
    console.log(`[INFO] ${new Date().toISOString()} - Connected to Redis`);
  });

  client.on('reconnecting', () => {
    reconnectCount++;
    console.log(`[INFO] ${new Date().toISOString()} - Reconnecting (attempt ${reconnectCount})...`);
  });

  client.on('ready', async () => {
    console.log(`[INFO] ${new Date().toISOString()} - Client is ready`);
    
    try {
      const info = await client.info('replication');
      const lines = info.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('role:')) {
          const role = line.split(':')[1].trim();
          console.log(`[INFO] ${new Date().toISOString()} - Connected to ${role}`);
        }
      }
    } catch (err) {
      console.error(`[ERROR] ${new Date().toISOString()} - Failed to get info: ${err.message}`);
    }
  });

  try {
    await client.connect();
    console.log('[SUCCESS] Initial connection established\n');

    // Monitor the cluster continuously
    console.log('Monitoring cluster (press Ctrl+C to stop)...\n');
    console.log('You can now test failover by running:');
    console.log('  docker stop redis-primary\n');
    console.log('And then restore it with:');
    console.log('  docker start redis-primary\n');
    
    let iteration = 0;
    const monitorInterval = setInterval(async () => {
      iteration++;
      
      try {
        // Try to write
        const key = `failover:test:${iteration}`;
        const value = `value-${Date.now()}`;
        
        const startTime = Date.now();
        await client.set(key, value);
        const duration = Date.now() - startTime;
        
        // Get current master info
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
        
        console.log(`[${new Date().toISOString()}] Write successful (${duration}ms) - Role: ${role}, Slaves: ${connectedSlaves}`);
        
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Write failed: ${err.message}`);
      }
    }, 2000);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n[INFO] Shutting down...');
      clearInterval(monitorInterval);
      // Note: createSentinel client doesn't have disconnect/quit methods in v5
      console.log('[INFO] Exiting...');
      process.exit(0);
    });

  } catch (err) {
    console.error('[ERROR] Test failed:', err);
    process.exit(1);
  }
}

testFailover();

