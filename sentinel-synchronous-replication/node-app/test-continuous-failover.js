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
        console.log(`[RECONNECT] Attempt ${retries}...`);
        if (retries > 20) {
          return new Error('Max reconnect attempts reached');
        }
        return Math.min(retries * 50, 1000);
      }
    }
  }
};

const COUNTER_KEY = 'failover:test:counter';
const HISTORY_KEY = 'failover:test:history';
const INTERVAL_MS = 100;

let writeCount = 0;
let readCount = 0;
let errorCount = 0;
let lastValue = 0;
let consecutiveErrors = 0;
let maxConsecutiveErrors = 0;
let writeHistory = [];

async function incrementAndRead(client) {
  const startTime = Date.now();
  
  try {
    // Increment the counter
    const newValue = await client.incr(COUNTER_KEY);
    const writeTime = Date.now();
    
    // Read it back
    const readValue = await client.get(COUNTER_KEY);
    const readTime = Date.now();
    
    writeCount++;
    readCount++;
    
    const totalLatency = readTime - startTime;
    const writeLatency = writeTime - startTime;
    
    // Track write history
    writeHistory.push({
      value: newValue,
      timestamp: Date.now(),
      writeLatency,
      totalLatency
    });
    
    // Keep only last 100 entries
    if (writeHistory.length > 100) {
      writeHistory.shift();
    }
    
    // Check for gaps
    if (lastValue > 0 && newValue !== lastValue + 1) {
      console.log(`[WARNING] Gap detected! Expected ${lastValue + 1}, got ${newValue}`);
    }
    
    lastValue = newValue;
    consecutiveErrors = 0;
    
    // Log every 10 writes
    if (writeCount % 10 === 0) {
      console.log(`[${new Date().toISOString()}] Counter: ${newValue} | Writes: ${writeCount} | Errors: ${errorCount} | Latency: ${totalLatency}ms`);
    }
    
  } catch (err) {
    errorCount++;
    consecutiveErrors++;
    
    if (consecutiveErrors > maxConsecutiveErrors) {
      maxConsecutiveErrors = consecutiveErrors;
    }
    
    console.log(`[ERROR] Write/Read failed (consecutive: ${consecutiveErrors}): ${err.message}`);
  }
}

async function getReplicationInfo(client) {
  try {
    const info = await client.info('replication');
    const lines = info.split('\n');
    
    let role = 'unknown';
    let connectedSlaves = 0;
    let masterHost = 'N/A';
    
    for (const line of lines) {
      if (line.startsWith('role:')) {
        role = line.split(':')[1].trim();
      } else if (line.startsWith('connected_slaves:')) {
        connectedSlaves = parseInt(line.split(':')[1]);
      } else if (line.startsWith('master_host:')) {
        masterHost = line.split(':')[1].trim();
      }
    }
    
    return { role, connectedSlaves, masterHost };
  } catch (err) {
    return { role: 'error', connectedSlaves: 0, masterHost: 'error' };
  }
}

async function runContinuousTest() {
  console.log('=== Continuous Failover Test ===\n');
  console.log('This test will:');
  console.log('1. Increment a counter every 100ms');
  console.log('2. Read the value back immediately');
  console.log('3. Continue during failover');
  console.log('4. Verify no data loss\n');
  console.log('Instructions:');
  console.log('- Let this run for ~10 seconds');
  console.log('- In another terminal, run: docker stop redis-replica-1');
  console.log('- Wait for failover to complete');
  console.log('- Press Ctrl+C to stop and see results\n');
  console.log('Starting in 3 seconds...\n');
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const client = createSentinel(sentinelConfig);
  
  try {
    await client.connect();
    console.log('[SUCCESS] Connected to Redis cluster\n');
    
    // Reset counter
    await client.set(COUNTER_KEY, '0');
    console.log('[INFO] Counter reset to 0\n');
    
    // Get initial master info
    const initialInfo = await getReplicationInfo(client);
    console.log(`[INFO] Initial master: role=${initialInfo.role}, slaves=${initialInfo.connectedSlaves}\n`);
    
    // Start the interval
    const interval = setInterval(() => {
      incrementAndRead(client);
    }, INTERVAL_MS);
    
    // Monitor replication info every 2 seconds
    const monitorInterval = setInterval(async () => {
      const info = await getReplicationInfo(client);
      console.log(`[MONITOR] Role: ${info.role} | Slaves: ${info.connectedSlaves} | Master: ${info.masterHost}`);
    }, 2000);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n=== Test Results ===\n');
      
      clearInterval(interval);
      clearInterval(monitorInterval);
      
      // Wait a moment for any pending operations
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get final value
      const finalValue = await client.get(COUNTER_KEY);
      
      console.log(`Total Writes: ${writeCount}`);
      console.log(`Total Reads: ${readCount}`);
      console.log(`Total Errors: ${errorCount}`);
      console.log(`Max Consecutive Errors: ${maxConsecutiveErrors}`);
      console.log(`Final Counter Value: ${finalValue}`);
      console.log(`Expected Value: ${writeCount}`);
      
      if (parseInt(finalValue) === writeCount) {
        console.log('\n✅ SUCCESS: All writes received! No data loss.');
      } else {
        console.log(`\n❌ FAILURE: Missing ${writeCount - parseInt(finalValue)} writes`);
      }
      
      // Calculate downtime
      const downtimeMs = maxConsecutiveErrors * INTERVAL_MS;
      console.log(`\nEstimated Max Downtime: ${downtimeMs}ms (${maxConsecutiveErrors} consecutive errors)`);
      
      // Show latency stats
      if (writeHistory.length > 0) {
        const latencies = writeHistory.map(h => h.totalLatency);
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const maxLatency = Math.max(...latencies);
        const minLatency = Math.min(...latencies);
        
        console.log(`\nLatency Stats (last ${writeHistory.length} operations):`);
        console.log(`  Min: ${minLatency}ms`);
        console.log(`  Avg: ${avgLatency.toFixed(2)}ms`);
        console.log(`  Max: ${maxLatency}ms`);
      }
      
      console.log('\n[INFO] Exiting...');
      process.exit(0);
    });
    
  } catch (err) {
    console.error('[ERROR] Test failed:', err);
    process.exit(1);
  }
}

runContinuousTest();

