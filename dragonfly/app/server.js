const express = require('express');
const { createClient } = require('redis');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(morgan('combined'));
app.use(express.static('public'));

// Configuration from environment variables
const DRAGONFLY_PRIMARY = process.env.DRAGONFLY_PRIMARY || 'dragonfly-primary:6379';
const DRAGONFLY_REPLICA_1 = process.env.DRAGONFLY_REPLICA_1 || 'dragonfly-replica-1:6380';
const DRAGONFLY_REPLICA_2 = process.env.DRAGONFLY_REPLICA_2 || 'dragonfly-replica-2:6381';

// Parse connection strings
function parseHost(hostStr) {
  const [host, port] = hostStr.split(':');
  return { host, port: parseInt(port) || 6379 };
}

const primaryConfig = parseHost(DRAGONFLY_PRIMARY);
const replica1Config = parseHost(DRAGONFLY_REPLICA_1);
const replica2Config = parseHost(DRAGONFLY_REPLICA_2);

console.log(`Connecting to DragonflyDB primary: ${primaryConfig.host}:${primaryConfig.port}`);
console.log(`Connecting to DragonflyDB replica 1: ${replica1Config.host}:${replica1Config.port}`);
console.log(`Connecting to DragonflyDB replica 2: ${replica2Config.host}:${replica2Config.port}`);

// Create Redis clients for primary (writes) and replicas (reads)
const primaryClient = createClient({
  socket: {
    host: primaryConfig.host,
    port: primaryConfig.port,
    reconnectStrategy: (retries) => {
      const delay = Math.min(retries * 50, 2000);
      return delay;
    }
  }
});

const replica1Client = createClient({
  socket: {
    host: replica1Config.host,
    port: replica1Config.port,
    reconnectStrategy: (retries) => {
      const delay = Math.min(retries * 50, 2000);
      return delay;
    }
  }
});

const replica2Client = createClient({
  socket: {
    host: replica2Config.host,
    port: replica2Config.port,
    reconnectStrategy: (retries) => {
      const delay = Math.min(retries * 50, 2000);
      return delay;
    }
  }
});

// Connection event handlers
primaryClient.on('connect', () => {
  console.log('Connected to DragonflyDB primary');
});

primaryClient.on('error', (err) => {
  console.error('DragonflyDB primary error:', err);
});

replica1Client.on('connect', () => {
  console.log('Connected to DragonflyDB replica 1');
});

replica1Client.on('error', (err) => {
  console.error('DragonflyDB replica 1 error:', err);
});

replica2Client.on('connect', () => {
  console.log('Connected to DragonflyDB replica 2');
});

replica2Client.on('error', (err) => {
  console.error('DragonflyDB replica 2 error:', err);
});

// Connect clients
(async () => {
  try {
    await primaryClient.connect();
    await replica1Client.connect();
    await replica2Client.connect();
    console.log('All DragonflyDB clients connected successfully');
  } catch (err) {
    console.error('Failed to connect to DragonflyDB:', err);
  }
})();

// Statistics tracking
let stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  reads: 0,
  writes: 0,
  startTime: Date.now()
};

// Helper functions
function generateRandomString(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomKey() {
  // Use a pool of 1000 keys to ensure some cache hits
  return `key:${Math.floor(Math.random() * 1000) + 1}`;
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Get a random replica client for read operations
function getReplicaClient() {
  return Math.random() < 0.5 ? replica1Client : replica2Client;
}

// Routes

// Health check
app.get('/health', async (req, res) => {
  try {
    // Test primary
    await primaryClient.set('_health_check', 'ok', { EX: 10 });
    const value = await primaryClient.get('_health_check');
    
    // Test replicas
    const replica1Ping = await replica1Client.ping();
    const replica2Ping = await replica2Client.ping();
    
    res.json({
      status: 'healthy',
      message: 'Connected to DragonflyDB HA cluster',
      primary: value === 'ok' ? 'healthy' : 'unhealthy',
      replica1: replica1Ping === 'PONG' ? 'healthy' : 'unhealthy',
      replica2: replica2Ping === 'PONG' ? 'healthy' : 'unhealthy'
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

// Get statistics
app.get('/stats', (req, res) => {
  const uptime = (Date.now() - stats.startTime) / 1000;
  const requestsPerSecond = stats.totalRequests / uptime;
  const successRate = stats.totalRequests > 0 
    ? (stats.successfulRequests / stats.totalRequests * 100).toFixed(2)
    : 0;

  res.json({
    ...stats,
    uptime: `${uptime.toFixed(2)}s`,
    requestsPerSecond: requestsPerSecond.toFixed(2),
    successRate: `${successRate}%`
  });
});

// Reset statistics
app.post('/stats/reset', (req, res) => {
  stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    reads: 0,
    writes: 0,
    startTime: Date.now()
  };
  res.json({ message: 'Statistics reset', stats });
});

// Write operations

// SET operation
app.post('/set', async (req, res) => {
  stats.totalRequests++;
  stats.writes++;

  try {
    const key = req.body.key || generateRandomKey();
    const value = req.body.value || generateRandomString();
    const ttl = req.body.ttl || 300; // 5 minutes default

    await primaryClient.set(key, value, { EX: ttl });
    stats.successfulRequests++;

    res.json({
      success: true,
      operation: 'SET',
      key,
      value,
      ttl
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// INCR operation
app.post('/incr', async (req, res) => {
  stats.totalRequests++;
  stats.writes++;
  
  try {
    const key = req.body.key || `counter:${getRandomInt(1, 100)}`;
    const result = await primaryClient.incr(key);
    stats.successfulRequests++;
    
    res.json({ 
      success: true, 
      operation: 'INCR',
      key, 
      value: result 
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// LPUSH operation
app.post('/lpush', async (req, res) => {
  stats.totalRequests++;
  stats.writes++;

  try {
    const key = req.body.key || `list:${getRandomInt(1, 50)}`;
    const value = req.body.value || generateRandomString();

    await primaryClient.lPush(key, value);
    await primaryClient.lTrim(key, 0, 99); // Keep list size manageable
    stats.successfulRequests++;

    res.json({
      success: true,
      operation: 'LPUSH',
      key,
      value
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// SADD operation
app.post('/sadd', async (req, res) => {
  stats.totalRequests++;
  stats.writes++;

  try {
    const key = req.body.key || `set:${getRandomInt(1, 50)}`;
    const value = req.body.value || generateRandomString();

    const result = await primaryClient.sAdd(key, value);
    stats.successfulRequests++;

    res.json({
      success: true,
      operation: 'SADD',
      key,
      value,
      added: result === 1
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// HSET operation
app.post('/hset', async (req, res) => {
  stats.totalRequests++;
  stats.writes++;

  try {
    const key = req.body.key || `hash:${getRandomInt(1, 50)}`;
    const field = req.body.field || generateRandomString(10);
    const value = req.body.value || generateRandomString();

    const result = await primaryClient.hSet(key, field, value);
    stats.successfulRequests++;

    res.json({
      success: true,
      operation: 'HSET',
      key,
      field,
      value,
      created: result === 1
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// Read operations

// GET operation
app.get('/get/:key?', async (req, res) => {
  stats.totalRequests++;
  stats.reads++;
  
  try {
    const key = req.params.key || generateRandomKey();
    const client = getReplicaClient();
    const value = await client.get(key);
    stats.successfulRequests++;
    
    res.json({ 
      success: true, 
      operation: 'GET',
      key, 
      value,
      found: value !== null 
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// EXISTS operation
app.get('/exists/:key?', async (req, res) => {
  stats.totalRequests++;
  stats.reads++;

  try {
    const key = req.params.key || generateRandomKey();
    const client = getReplicaClient();
    const exists = await client.exists(key);
    stats.successfulRequests++;

    res.json({
      success: true,
      operation: 'EXISTS',
      key,
      exists: exists === 1
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// LRANGE operation
app.get('/lrange/:key?', async (req, res) => {
  stats.totalRequests++;
  stats.reads++;

  try {
    const key = req.params.key || `list:${getRandomInt(1, 50)}`;
    const start = parseInt(req.query.start) || 0;
    const stop = parseInt(req.query.stop) || 10;
    const client = getReplicaClient();

    const values = await client.lRange(key, start, stop);
    stats.successfulRequests++;

    res.json({
      success: true,
      operation: 'LRANGE',
      key,
      start,
      stop,
      values,
      count: values.length
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// SMEMBERS operation
app.get('/smembers/:key?', async (req, res) => {
  stats.totalRequests++;
  stats.reads++;

  try {
    const key = req.params.key || `set:${getRandomInt(1, 50)}`;
    const client = getReplicaClient();
    const members = await client.sMembers(key);
    stats.successfulRequests++;

    res.json({
      success: true,
      operation: 'SMEMBERS',
      key,
      members,
      count: members.length
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// HGETALL operation
app.get('/hgetall/:key?', async (req, res) => {
  stats.totalRequests++;
  stats.reads++;

  try {
    const key = req.params.key || `hash:${getRandomInt(1, 50)}`;
    const client = getReplicaClient();
    const hash = await client.hGetAll(key);
    stats.successfulRequests++;

    res.json({
      success: true,
      operation: 'HGETALL',
      key,
      hash,
      fieldCount: Object.keys(hash || {}).length
    });
  } catch (error) {
    stats.failedRequests++;
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mixed load generation endpoint
app.post('/load', async (req, res) => {
  const operations = parseInt(req.body.operations) || 100;
  const readWriteRatio = parseInt(req.body.readWriteRatio) || 70; // % reads

  const results = {
    requested: operations,
    completed: 0,
    successful: 0,
    failed: 0,
    reads: 0,
    writes: 0
  };

  const writeOps = ['set', 'incr', 'lpush', 'sadd', 'hset'];
  const readOps = ['get', 'exists', 'lrange', 'smembers', 'hgetall'];

  for (let i = 0; i < operations; i++) {
    try {
      const isRead = Math.random() * 100 <= readWriteRatio;

      if (isRead) {
        const op = readOps[Math.floor(Math.random() * readOps.length)];
        const client = getReplicaClient();
        results.reads++;

        switch (op) {
          case 'get':
            await client.get(generateRandomKey());
            break;
          case 'exists':
            await client.exists(generateRandomKey());
            break;
          case 'lrange':
            await client.lRange(`list:${getRandomInt(1, 50)}`, 0, 10);
            break;
          case 'smembers':
            await client.sMembers(`set:${getRandomInt(1, 50)}`);
            break;
          case 'hgetall':
            await client.hGetAll(`hash:${getRandomInt(1, 50)}`);
            break;
        }
      } else {
        const op = writeOps[Math.floor(Math.random() * writeOps.length)];
        results.writes++;

        switch (op) {
          case 'set':
            await primaryClient.set(generateRandomKey(), generateRandomString(), { EX: 300 });
            break;
          case 'incr':
            await primaryClient.incr(`counter:${getRandomInt(1, 100)}`);
            break;
          case 'lpush':
            const listKey = `list:${getRandomInt(1, 50)}`;
            await primaryClient.lPush(listKey, generateRandomString());
            await primaryClient.lTrim(listKey, 0, 99);
            break;
          case 'sadd':
            await primaryClient.sAdd(`set:${getRandomInt(1, 50)}`, generateRandomString());
            break;
          case 'hset':
            await primaryClient.hSet(`hash:${getRandomInt(1, 50)}`, generateRandomString(10), generateRandomString());
            break;
        }
      }

      results.successful++;
    } catch (error) {
      results.failed++;
    }

    results.completed++;
  }

  stats.totalRequests += results.completed;
  stats.successfulRequests += results.successful;
  stats.failedRequests += results.failed;
  stats.reads += results.reads;
  stats.writes += results.writes;

  res.json({
    success: true,
    message: 'Load generation completed',
    results
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /health - Health check');
  console.log('  GET  /stats - View statistics');
  console.log('  POST /stats/reset - Reset statistics');
  console.log('  POST /set - SET operation');
  console.log('  POST /incr - INCR operation');
  console.log('  POST /lpush - LPUSH operation');
  console.log('  POST /sadd - SADD operation');
  console.log('  POST /hset - HSET operation');
  console.log('  GET  /get/:key? - GET operation');
  console.log('  GET  /exists/:key? - EXISTS operation');
  console.log('  GET  /lrange/:key? - LRANGE operation');
  console.log('  GET  /smembers/:key? - SMEMBERS operation');
  console.log('  GET  /hgetall/:key? - HGETALL operation');
  console.log('  POST /load - Generate mixed load');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  await primaryClient.quit();
  await replica1Client.quit();
  await replica2Client.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing connections...');
  await primaryClient.quit();
  await replica1Client.quit();
  await replica2Client.quit();
  process.exit(0);
});

