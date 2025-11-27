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
// For node-redis, we'll connect directly to Redis nodes
// Sentinel monitoring is handled by the Sentinel containers
const REDIS_MASTER_HOST = process.env.REDIS_MASTER_HOST || 'redis-primary';
const REDIS_MASTER_PORT = parseInt(process.env.REDIS_MASTER_PORT || '6379');
const REDIS_SLAVE_HOST = process.env.REDIS_SLAVE_HOST || 'redis-replica-1';
const REDIS_SLAVE_PORT = parseInt(process.env.REDIS_SLAVE_PORT || '6379');

console.log(`Connecting to Redis master: ${REDIS_MASTER_HOST}:${REDIS_MASTER_PORT}`);
console.log(`Connecting to Redis slave: ${REDIS_SLAVE_HOST}:${REDIS_SLAVE_PORT}`);

// Create Redis clients for master (writes) and slave (reads)
const masterClient = createClient({
  socket: {
    host: REDIS_MASTER_HOST,
    port: REDIS_MASTER_PORT,
    reconnectStrategy: (retries) => {
      const delay = Math.min(retries * 50, 2000);
      return delay;
    }
  }
});

const slaveClient = createClient({
  socket: {
    host: REDIS_SLAVE_HOST,
    port: REDIS_SLAVE_PORT,
    reconnectStrategy: (retries) => {
      const delay = Math.min(retries * 50, 2000);
      return delay;
    }
  }
});

// Connection event handlers
masterClient.on('connect', () => {
  console.log('Connected to Redis master');
});

masterClient.on('error', (err) => {
  console.error('Redis master error:', err);
});

slaveClient.on('connect', () => {
  console.log('Connected to Redis slave');
});

slaveClient.on('error', (err) => {
  console.error('Redis slave error:', err);
});

// Connect clients
(async () => {
  try {
    await masterClient.connect();
    await slaveClient.connect();
    console.log('Redis clients connected successfully');
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
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

// Routes

// Health check
app.get('/health', async (req, res) => {
  try {
    await masterClient.ping();
    await slaveClient.ping();
    res.json({ status: 'healthy', message: 'Connected to Redis cluster' });
  } catch (error) {
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

    await masterClient.set(key, value, { EX: ttl });
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
    const result = await masterClient.incr(key);
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

    await masterClient.lPush(key, value);
    await masterClient.lTrim(key, 0, 99); // Keep list size manageable
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

    const result = await masterClient.sAdd(key, value);
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

    const result = await masterClient.hSet(key, field, value);
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
    const value = await slaveClient.get(key);
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
    const exists = await slaveClient.exists(key);
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

    const values = await slaveClient.lRange(key, start, stop);
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
    const members = await slaveClient.sMembers(key);
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
    const hash = await slaveClient.hGetAll(key);
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
        results.reads++;
        
        switch (op) {
          case 'get':
            await slaveClient.get(generateRandomKey());
            break;
          case 'exists':
            await slaveClient.exists(generateRandomKey());
            break;
          case 'lrange':
            await slaveClient.lRange(`list:${getRandomInt(1, 50)}`, 0, 10);
            break;
          case 'smembers':
            await slaveClient.sMembers(`set:${getRandomInt(1, 50)}`);
            break;
          case 'hgetall':
            await slaveClient.hGetAll(`hash:${getRandomInt(1, 50)}`);
            break;
        }
      } else {
        const op = writeOps[Math.floor(Math.random() * writeOps.length)];
        results.writes++;
        
        switch (op) {
          case 'set':
            await masterClient.set(generateRandomKey(), generateRandomString(), { EX: 300 });
            break;
          case 'incr':
            await masterClient.incr(`counter:${getRandomInt(1, 100)}`);
            break;
          case 'lpush':
            const listKey = `list:${getRandomInt(1, 50)}`;
            await masterClient.lPush(listKey, generateRandomString());
            await masterClient.lTrim(listKey, 0, 99);
            break;
          case 'sadd':
            await masterClient.sAdd(`set:${getRandomInt(1, 50)}`, generateRandomString());
            break;
          case 'hset':
            await masterClient.hSet(`hash:${getRandomInt(1, 50)}`, generateRandomString(10), generateRandomString());
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
  await masterClient.quit();
  await slaveClient.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing connections...');
  await masterClient.quit();
  await slaveClient.quit();
  process.exit(0);
});

