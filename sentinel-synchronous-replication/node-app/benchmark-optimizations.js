/**
 * Optimization Testing Benchmark
 * 
 * Tests various Redis and client-side optimizations
 */

const { createClient } = require('redis');

const CONFIG = {
  masterUrl: 'redis://localhost:6379',
  opsPerTest: 5000,
  payloadSize: 256,
};

function generatePayload(size) {
  return 'x'.repeat(size);
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function formatResult(latencies) {
  const totalTime = latencies.reduce((a, b) => a + b, 0);
  return {
    throughput: Math.round(latencies.length / (totalTime / 1000)),
    p50: percentile(latencies, 50).toFixed(3),
    p99: percentile(latencies, 99).toFixed(3),
    p999: percentile(latencies, 99.9).toFixed(3),
  };
}

// Test: Pipeline + WAIT (batched synchronous writes)
async function testPipelineWithWait(client, ops, pipelineSize, waitReplicas) {
  const payload = generatePayload(CONFIG.payloadSize);
  const latencies = [];
  const batches = Math.ceil(ops / pipelineSize);
  let ackFailures = 0;
  
  for (let b = 0; b < batches; b++) {
    const start = process.hrtime.bigint();
    const pipeline = client.multi();
    
    const batchSize = Math.min(pipelineSize, ops - b * pipelineSize);
    for (let i = 0; i < batchSize; i++) {
      pipeline.set(`pipe-wait:${b * pipelineSize + i}`, payload);
    }
    
    await pipeline.exec();
    
    // Single WAIT after entire batch
    if (waitReplicas > 0) {
      const acks = await client.wait(waitReplicas, 1000);
      if (acks < waitReplicas) ackFailures++;
    }
    
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    latencies.push(latencyMs);
  }
  
  const totalTime = latencies.reduce((a, b) => a + b, 0);
  return {
    opsPerSec: Math.round(ops / (totalTime / 1000)),
    batchLatency: formatResult(latencies),
    ackFailures,
  };
}

// Test: Different WAIT timeout values
async function testWaitTimeouts(client, ops, waitReplicas) {
  const payload = generatePayload(CONFIG.payloadSize);
  const results = {};
  
  for (const timeout of [0, 1, 10, 100, 1000]) {
    const latencies = [];
    let ackFailures = 0;
    
    for (let i = 0; i < ops; i++) {
      const start = process.hrtime.bigint();
      await client.set(`wait-timeout:${timeout}:${i}`, payload);
      const acks = await client.wait(waitReplicas, timeout);
      if (acks < waitReplicas) ackFailures++;
      latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    
    results[timeout] = { ...formatResult(latencies), ackFailures };
  }
  
  return results;
}

// Test: Connection pool comparison
async function testConnectionPool(masterUrl, ops, poolSize) {
  const payload = generatePayload(CONFIG.payloadSize);
  const clients = [];
  
  for (let i = 0; i < poolSize; i++) {
    const client = createClient({ url: masterUrl });
    await client.connect();
    clients.push(client);
  }
  
  const latencies = [];
  const startTotal = process.hrtime.bigint();
  
  await Promise.all(Array(ops).fill().map(async (_, i) => {
    const client = clients[i % poolSize];
    const start = process.hrtime.bigint();
    await client.set(`pool:${i}`, payload);
    await client.wait(1, 100);
    latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
  }));
  
  const totalTimeMs = Number(process.hrtime.bigint() - startTotal) / 1e6;
  
  await Promise.all(clients.map(c => c.disconnect()));
  
  return {
    ...formatResult(latencies),
    aggregateThroughput: Math.round(ops / (totalTimeMs / 1000)),
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('     OPTIMIZATION TESTING BENCHMARK');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const client = createClient({ url: CONFIG.masterUrl });
  await client.connect();
  
  // ─────────────────────────────────────────────────────────────────────
  // Test 1: Pipeline + WAIT (amortize WAIT overhead)
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  TEST 1: Pipeline + WAIT (batched sync writes)');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  console.log('   Pipe Size | WAIT | Ops/sec | Batch p50 | Batch p99 | ACK Fail');
  console.log('   ----------|------|---------|-----------|-----------|----------');
  
  for (const pipeSize of [1, 10, 50, 100]) {
    for (const wait of [0, 1, 2]) {
      const result = await testPipelineWithWait(client, CONFIG.opsPerTest, pipeSize, wait);
      console.log(`   ${pipeSize.toString().padStart(9)} | ${wait.toString().padStart(4)} | ${result.opsPerSec.toString().padStart(7)} | ${result.batchLatency.p50.padStart(9)} | ${result.batchLatency.p99.padStart(9)} | ${result.ackFailures.toString().padStart(8)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Test 2: WAIT timeout impact
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  TEST 2: WAIT Timeout Impact');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('   Timeout(ms) | Throughput | p50(ms) | p99(ms) | ACK Failures');
  console.log('   ------------|------------|---------|---------|-------------');

  const timeoutResults = await testWaitTimeouts(client, 2000, 1);
  for (const [timeout, result] of Object.entries(timeoutResults)) {
    console.log(`   ${timeout.padStart(11)} | ${result.throughput.toString().padStart(10)} | ${result.p50.padStart(7)} | ${result.p99.padStart(7)} | ${result.ackFailures.toString().padStart(12)}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Test 3: Connection pool scaling with WAIT
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  TEST 3: Connection Pool Scaling (with WAIT 1)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('   Pool Size | Agg Throughput | p50(ms) | p99(ms) | p99.9(ms)');
  console.log('   ----------|----------------|---------|---------|----------');

  for (const poolSize of [1, 5, 10, 20, 50]) {
    const result = await testConnectionPool(CONFIG.masterUrl, 2000, poolSize);
    console.log(`   ${poolSize.toString().padStart(9)} | ${result.aggregateThroughput.toString().padStart(14)} | ${result.p50.padStart(7)} | ${result.p99.padStart(7)} | ${result.p999.padStart(9)}`);
  }

  await client.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  OPTIMIZATION TESTS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Summary
  console.log('📊 KEY FINDINGS:');
  console.log('   1. Pipeline + single WAIT amortizes sync overhead across batch');
  console.log('   2. WAIT timeout=0 (fire-and-forget) vs timeout>0 shows ACK behavior');
  console.log('   3. Connection pooling enables parallel WAIT operations');
  console.log('\n');
}

main().catch(console.error);

