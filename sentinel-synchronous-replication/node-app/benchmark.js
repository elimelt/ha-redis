/**
 * Comprehensive Redis Synchronous Replication Benchmark Suite
 * 
 * Tests throughput, latency, WAIT command, consistency, and failure scenarios
 */

const { createClient } = require('redis');

// Configuration
const CONFIG = {
  masterUrl: 'redis://localhost:6379',
  replica1Url: 'redis://localhost:6380',
  replica2Url: 'redis://localhost:6381',
  warmupOps: 1000,
  defaultOps: 10000,
  payloadSizes: [64, 256, 1024, 4096],  // bytes
  concurrencyLevels: [1, 10, 50, 100],
  pipelineSizes: [1, 10, 50, 100],
};

// Utility: Generate random payload
function generatePayload(size) {
  return 'x'.repeat(size);
}

// Utility: Calculate percentiles
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// Utility: Format stats
function formatStats(latencies) {
  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    count: latencies.length,
    min: Math.min(...latencies).toFixed(3),
    max: Math.max(...latencies).toFixed(3),
    avg: (sum / latencies.length).toFixed(3),
    p50: percentile(latencies, 50).toFixed(3),
    p95: percentile(latencies, 95).toFixed(3),
    p99: percentile(latencies, 99).toFixed(3),
    p999: percentile(latencies, 99.9).toFixed(3),
    throughput: (latencies.length / (sum / 1000)).toFixed(0),
  };
}

// Benchmark: Basic SET throughput (no explicit WAIT)
async function benchmarkAsyncWrites(client, ops, payloadSize) {
  const payload = generatePayload(payloadSize);
  const latencies = [];
  
  for (let i = 0; i < ops; i++) {
    const start = process.hrtime.bigint();
    await client.set(`bench:async:${i}`, payload);
    const end = process.hrtime.bigint();
    latencies.push(Number(end - start) / 1e6); // ms
  }
  
  return formatStats(latencies);
}

// Benchmark: SET with explicit WAIT command
async function benchmarkSyncWrites(client, ops, payloadSize, numReplicas = 1, timeoutMs = 1000) {
  const payload = generatePayload(payloadSize);
  const latencies = [];
  let ackFailures = 0;
  
  for (let i = 0; i < ops; i++) {
    const start = process.hrtime.bigint();
    await client.set(`bench:sync:${i}`, payload);
    const acks = await client.wait(numReplicas, timeoutMs);
    const end = process.hrtime.bigint();
    
    if (acks < numReplicas) ackFailures++;
    latencies.push(Number(end - start) / 1e6);
  }
  
  return { ...formatStats(latencies), ackFailures };
}

// Benchmark: Pipelined writes
async function benchmarkPipelinedWrites(client, ops, payloadSize, pipelineSize) {
  const payload = generatePayload(payloadSize);
  const latencies = [];
  const batches = Math.ceil(ops / pipelineSize);
  
  for (let b = 0; b < batches; b++) {
    const start = process.hrtime.bigint();
    const pipeline = client.multi();
    
    for (let i = 0; i < pipelineSize && (b * pipelineSize + i) < ops; i++) {
      pipeline.set(`bench:pipe:${b * pipelineSize + i}`, payload);
    }
    
    await pipeline.exec();
    const end = process.hrtime.bigint();
    latencies.push(Number(end - start) / 1e6);
  }
  
  return { 
    batchStats: formatStats(latencies),
    opsPerSec: (ops / (latencies.reduce((a, b) => a + b, 0) / 1000)).toFixed(0)
  };
}

// Benchmark: Concurrent clients
async function benchmarkConcurrent(masterUrl, ops, payloadSize, numClients) {
  const opsPerClient = Math.ceil(ops / numClients);
  const clients = [];
  
  // Create clients
  for (let i = 0; i < numClients; i++) {
    const client = createClient({ url: masterUrl });
    await client.connect();
    clients.push(client);
  }
  
  const payload = generatePayload(payloadSize);
  const allLatencies = [];
  
  const startTotal = process.hrtime.bigint();
  
  await Promise.all(clients.map(async (client, clientIdx) => {
    for (let i = 0; i < opsPerClient; i++) {
      const start = process.hrtime.bigint();
      await client.set(`bench:conc:${clientIdx}:${i}`, payload);
      const end = process.hrtime.bigint();
      allLatencies.push(Number(end - start) / 1e6);
    }
  }));
  
  const endTotal = process.hrtime.bigint();
  const totalTimeMs = Number(endTotal - startTotal) / 1e6;
  
  // Cleanup
  await Promise.all(clients.map(c => c.disconnect()));
  
  return {
    ...formatStats(allLatencies),
    totalTimeMs: totalTimeMs.toFixed(2),
    aggregateThroughput: (allLatencies.length / (totalTimeMs / 1000)).toFixed(0),
  };
}

// Benchmark: Read-after-write consistency check
async function benchmarkReadAfterWrite(masterClient, replicaClients, ops, payloadSize) {
  const payload = generatePayload(payloadSize);
  const consistencyResults = { immediate: 0, afterWait: 0, failed: 0 };
  const latencies = [];

  for (let i = 0; i < ops; i++) {
    const key = `bench:consistency:${i}`;
    const value = `${payload}:${Date.now()}:${i}`;

    const start = process.hrtime.bigint();
    await masterClient.set(key, value);

    // Check immediate read from replica
    const replicaValue = await replicaClients[0].get(key);
    if (replicaValue === value) {
      consistencyResults.immediate++;
    } else {
      // Wait and retry
      await masterClient.wait(1, 100);
      const retryValue = await replicaClients[0].get(key);
      if (retryValue === value) {
        consistencyResults.afterWait++;
      } else {
        consistencyResults.failed++;
      }
    }

    const end = process.hrtime.bigint();
    latencies.push(Number(end - start) / 1e6);
  }

  return { consistencyResults, ...formatStats(latencies) };
}

// Get replication info
async function getReplicationInfo(client) {
  const info = await client.info('replication');
  const lines = info.split('\n');
  const result = {};

  for (const line of lines) {
    if (line.includes(':')) {
      const [key, value] = line.split(':');
      result[key.trim()] = value?.trim();
    }
  }
  return result;
}

// Main benchmark runner
async function runBenchmarks() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('     REDIS SYNCHRONOUS REPLICATION BENCHMARK SUITE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Connect to master
  const master = createClient({ url: CONFIG.masterUrl });
  await master.connect();

  // Connect to replicas for consistency tests
  const replica1 = createClient({ url: CONFIG.replica1Url });
  const replica2 = createClient({ url: CONFIG.replica2Url });
  await replica1.connect();
  await replica2.connect();

  // Get initial state
  const replInfo = await getReplicationInfo(master);
  console.log('📊 Cluster State:');
  console.log(`   Role: ${replInfo.role}`);
  console.log(`   Connected Replicas: ${replInfo.connected_slaves}`);
  console.log(`   Master Repl Offset: ${replInfo.master_repl_offset}`);

  const minReplicas = await master.configGet('min-replicas-to-write');
  const maxLag = await master.configGet('min-replicas-max-lag');
  console.log(`   min-replicas-to-write: ${minReplicas['min-replicas-to-write']}`);
  console.log(`   min-replicas-max-lag: ${maxLag['min-replicas-max-lag']}s\n`);

  // Warmup
  console.log('🔥 Warming up...');
  await benchmarkAsyncWrites(master, CONFIG.warmupOps, 64);
  console.log('   Done.\n');

  const results = {};

  // ─────────────────────────────────────────────────────────────────────
  // BENCHMARK 1: Async vs Sync (WAIT) comparison
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK 1: Async vs Sync (WAIT) Writes');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  results.asyncVsSync = {};

  for (const size of [64, 1024]) {
    console.log(`📦 Payload Size: ${size} bytes\n`);

    const asyncResult = await benchmarkAsyncWrites(master, CONFIG.defaultOps, size);
    console.log(`   Async (no WAIT):`);
    console.log(`      Throughput: ${asyncResult.throughput} ops/sec`);
    console.log(`      Latency: p50=${asyncResult.p50}ms p99=${asyncResult.p99}ms p99.9=${asyncResult.p999}ms\n`);

    const sync1Result = await benchmarkSyncWrites(master, CONFIG.defaultOps, size, 1, 1000);
    console.log(`   Sync (WAIT 1 replica):`);
    console.log(`      Throughput: ${sync1Result.throughput} ops/sec`);
    console.log(`      Latency: p50=${sync1Result.p50}ms p99=${sync1Result.p99}ms p99.9=${sync1Result.p999}ms`);
    console.log(`      ACK Failures: ${sync1Result.ackFailures}\n`);

    const sync2Result = await benchmarkSyncWrites(master, CONFIG.defaultOps, size, 2, 1000);
    console.log(`   Sync (WAIT 2 replicas):`);
    console.log(`      Throughput: ${sync2Result.throughput} ops/sec`);
    console.log(`      Latency: p50=${sync2Result.p50}ms p99=${sync2Result.p99}ms p99.9=${sync2Result.p999}ms`);
    console.log(`      ACK Failures: ${sync2Result.ackFailures}\n`);

    results.asyncVsSync[size] = { async: asyncResult, sync1: sync1Result, sync2: sync2Result };
  }

  // ─────────────────────────────────────────────────────────────────────
  // BENCHMARK 2: Payload size impact
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK 2: Payload Size Impact');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  results.payloadSize = {};
  console.log('   Size(B) | Throughput | p50(ms) | p99(ms) | p99.9(ms)');
  console.log('   --------|------------|---------|---------|----------');

  for (const size of CONFIG.payloadSizes) {
    const result = await benchmarkSyncWrites(master, 5000, size, 1, 1000);
    console.log(`   ${size.toString().padStart(6)} | ${result.throughput.padStart(10)} | ${result.p50.padStart(7)} | ${result.p99.padStart(7)} | ${result.p999.padStart(9)}`);
    results.payloadSize[size] = result;
  }
  console.log('\n');

  // ─────────────────────────────────────────────────────────────────────
  // BENCHMARK 3: Concurrent connections
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK 3: Concurrent Connections');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  results.concurrent = {};
  console.log('   Clients | Agg Throughput | p50(ms) | p99(ms) | p99.9(ms)');
  console.log('   --------|----------------|---------|---------|----------');

  for (const numClients of CONFIG.concurrencyLevels) {
    const result = await benchmarkConcurrent(CONFIG.masterUrl, 5000, 256, numClients);
    console.log(`   ${numClients.toString().padStart(7)} | ${result.aggregateThroughput.padStart(14)} | ${result.p50.padStart(7)} | ${result.p99.padStart(7)} | ${result.p999.padStart(9)}`);
    results.concurrent[numClients] = result;
  }
  console.log('\n');

  // ─────────────────────────────────────────────────────────────────────
  // BENCHMARK 4: Pipeline performance
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK 4: Pipeline Performance');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  results.pipeline = {};
  console.log('   Pipe Size | Ops/sec | Batch p50(ms) | Batch p99(ms)');
  console.log('   ----------|---------|---------------|---------------');

  for (const pipeSize of CONFIG.pipelineSizes) {
    const result = await benchmarkPipelinedWrites(master, 10000, 256, pipeSize);
    console.log(`   ${pipeSize.toString().padStart(9)} | ${result.opsPerSec.padStart(7)} | ${result.batchStats.p50.padStart(13)} | ${result.batchStats.p99.padStart(13)}`);
    results.pipeline[pipeSize] = result;
  }
  console.log('\n');

  // ─────────────────────────────────────────────────────────────────────
  // BENCHMARK 5: Read-after-write consistency
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK 5: Read-After-Write Consistency');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const consistencyResult = await benchmarkReadAfterWrite(master, [replica1, replica2], 1000, 64);
  console.log(`   Consistency Check Results (1000 ops):`);
  console.log(`      Immediately consistent: ${consistencyResult.consistencyResults.immediate} (${(consistencyResult.consistencyResults.immediate / 10).toFixed(1)}%)`);
  console.log(`      Consistent after WAIT:  ${consistencyResult.consistencyResults.afterWait} (${(consistencyResult.consistencyResults.afterWait / 10).toFixed(1)}%)`);
  console.log(`      Failed:                 ${consistencyResult.consistencyResults.failed} (${(consistencyResult.consistencyResults.failed / 10).toFixed(1)}%)`);
  console.log(`\n   Latency: p50=${consistencyResult.p50}ms p99=${consistencyResult.p99}ms\n`);

  results.consistency = consistencyResult;

  // Cleanup
  await master.disconnect();
  await replica1.disconnect();
  await replica2.disconnect();

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BENCHMARK COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  return results;
}

// Run if executed directly
if (require.main === module) {
  runBenchmarks()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}

module.exports = { runBenchmarks, benchmarkAsyncWrites, benchmarkSyncWrites, CONFIG };

