const { createSentinel } = require('redis');

// Sentinel instance
let client = null;

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
        if (retries > 20) {
          console.log('[DEBUG] Max reconnect attempts reached');
          return new Error('Max reconnect attempts reached');
        }
        return Math.min(retries * 100, 3000);
      }
    }
  }
};

// Counter for operations
let operationCount = 0;
let successCount = 0;
let failureCount = 0;
let testInterval = null;

// Initialize connection
async function initialize() {
  try {
    client = createSentinel(sentinelConfig)
      .on('error', (err) => {
        console.error('✗ Error:', err.message);
        console.log('[DEBUG] Error type:', err.constructor.name);
      })
      .on('reconnecting', () => {
        console.log('🔄 Reconnecting to Redis...');
        logConnectionInfo();
      })
      .on('ready', () => {
        console.log('✓ Client ready');
        logConnectionInfo();
      })
      .on('sentinel-error', (err) => {
        console.error('✗ Sentinel error:', err);
      });
    
    await client.connect();
    console.log('✓ Connected to Redis via Sentinel');
    
    // Get connection info
    await logConnectionInfo();
    console.log('');
    
    // Start testing
    startTesting();
  } catch (err) {
    console.error('✗ Failed to initialize:', err);
    process.exit(1);
  }
}

async function logConnectionInfo() {
  try {
    const info = await client.info('replication');
    const lines = info.split('\n');
    const roleLine = lines.find(l => l.startsWith('role:'));
    
    if (roleLine) {
      const role = roleLine.split(':')[1].trim();
      console.log(`   [DEBUG] Client role: ${role}`);
    }
    
    const clientInfo = await client.clientInfo();
    if (clientInfo.laddr) {
      console.log(`   [DEBUG] Connected to: ${clientInfo.laddr}`);
    }
  } catch (e) {
    console.log(`   [DEBUG] Could not get connection info: ${e.message}`);
  }
}

// Query sentinel for current master info
async function querySentinelMaster() {
  const net = require('net');
  
  return new Promise((resolve, reject) => {
    const sentinelClient = net.createConnection({ host: 'localhost', port: 26379 }, () => {
      sentinelClient.write('*3\r\n$8\r\nSENTINEL\r\n$23\r\nget-master-addr-by-name\r\n$8\r\nmymaster\r\n');
    });
    
    let data = '';
    sentinelClient.on('data', (chunk) => {
      data += chunk.toString();
      if (data.includes('\r\n')) {
        sentinelClient.end();
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
    
    sentinelClient.on('error', (err) => {
      reject(err);
    });
    
    setTimeout(() => {
      sentinelClient.end();
      reject(new Error('Timeout querying sentinel'));
    }, 5000);
  });
}

// Perform a GET/SET test
async function performTest() {
  operationCount++;
  const timestamp = new Date().toISOString();
  const key = `test:key:${operationCount}`;
  const value = `value-${operationCount}-${Date.now()}`;
  
  try {
    // SET operation
    await client.set(key, value, { EX: 60 });
    console.log(`[${timestamp}] ✓ SET ${key} = ${value}`);
    
    // GET operation
    const retrieved = await client.get(key);
    
    if (retrieved === value) {
      console.log(`[${timestamp}] ✓ GET ${key} = ${retrieved} (MATCH)`);
      successCount++;
    } else {
      console.log(`[${timestamp}] ✗ GET ${key} = ${retrieved} (MISMATCH, expected: ${value})`);
      failureCount++;
    }
    
    // Log stats every 10 operations
    if (operationCount % 10 === 0) {
      console.log(`\n--- Stats: ${successCount} success, ${failureCount} failures out of ${operationCount} operations ---`);
      await logConnectionInfo();
      
      // Query sentinel for current master
      try {
        const master = await querySentinelMaster();
        console.log(`[DEBUG] Sentinel reports current master: ${master.host}:${master.port}\n`);
      } catch (err) {
        console.log(`[DEBUG] Failed to query sentinel: ${err.message}\n`);
      }
    }
  } catch (err) {
    console.error(`[${timestamp}] ✗ Operation #${operationCount} failed: ${err.message}`);
    console.log(`   [DEBUG] Error type: ${err.constructor.name}`);
    failureCount++;
    
    // Try to get connection status
    try {
      const isOpen = client.isOpen;
      const isReady = client.isReady;
      console.log(`   [DEBUG] Client state - isOpen: ${isOpen}, isReady: ${isReady}`);
    } catch (e) {
      console.log(`   [DEBUG] Could not get client state`);
    }
  }
}

// Start periodic testing
function startTesting() {
  console.log('=== Starting GET/SET tests every 2 seconds ===');
  console.log('Trigger a failover to test reconnection behavior\n');
  
  // Run first test immediately
  performTest();
  
  // Then run every 2 seconds
  testInterval = setInterval(performTest, 2000);
}

// Graceful shutdown
async function shutdown() {
  console.log('\n\n--- Shutting down ---');
  
  if (testInterval) {
    clearInterval(testInterval);
  }
  
  console.log(`\nFinal Stats: ${successCount} success, ${failureCount} failures out of ${operationCount} operations`);
  const successRate = operationCount > 0 ? ((successCount / operationCount) * 100).toFixed(2) : 0;
  console.log(`Success rate: ${successRate}%\n`);
  
  try {
    if (client) {
      await client.disconnect();
      console.log('✓ Disconnected from Redis');
    }
  } catch (err) {
    console.error('✗ Error during shutdown:', err);
  }
  
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the application
console.log('=== Redis Sentinel Basic GET/SET Test ===');
console.log(`Connecting to Sentinel at localhost:26379, 26380, 26381`);
console.log(`Master name: mymaster\n`);

initialize();

