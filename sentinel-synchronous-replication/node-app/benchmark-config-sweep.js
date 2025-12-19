/**
 * Configuration Sweep Benchmark
 * 
 * Tests performance under different synchronous replication configurations
 */

const { createClient } = require('redis');

const CONFIG = {
  masterUrl: 'redis://localhost:6379',
  opsPerConfig: 5000,
  payloadSize: 256,
  
  // Configurations to test
  minReplicasSettings: [0, 1, 2],
  maxLagSettings: [1, 5, 10],
};

function generatePayload(size) {
  return 'x'.repeat(size);
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function setConfig(client, minReplicas, maxLag) {
  await client.configSet('min-replicas-to-write', minReplicas.toString());
  await client.configSet('min-replicas-max-lag', maxLag.toString());
}

async function benchmarkConfig(client, ops, payloadSize) {
  const payload = generatePayload(payloadSize);
  const latencies = [];
  let errors = 0;
  
  for (let i = 0; i < ops; i++) {
    const start = process.hrtime.bigint();
    try {
      await client.set(`config:sweep:${i}`, payload);
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      latencies.push(latencyMs);
    } catch (err) {
      errors++;
    }
  }
  
  if (latencies.length === 0) {
    return { success: 0, errors, throughput: 0, p50: 0, p99: 0 };
  }
  
  const totalTime = latencies.reduce((a, b) => a + b, 0);
  return {
    success: latencies.length,
    errors,
    throughput: Math.round(latencies.length / (totalTime / 1000)),
    p50: percentile(latencies, 50).toFixed(3),
    p99: percentile(latencies, 99).toFixed(3),
    p999: percentile(latencies, 99.9).toFixed(3),
  };
}

async function benchmarkWithWait(client, ops, payloadSize, numReplicas) {
  const payload = generatePayload(payloadSize);
  const latencies = [];
  let errors = 0;
  let ackFailures = 0;
  
  for (let i = 0; i < ops; i++) {
    const start = process.hrtime.bigint();
    try {
      await client.set(`wait:sweep:${i}`, payload);
      const acks = await client.wait(numReplicas, 100);
      if (acks < numReplicas) ackFailures++;
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      latencies.push(latencyMs);
    } catch (err) {
      errors++;
    }
  }
  
  if (latencies.length === 0) {
    return { success: 0, errors, throughput: 0, p50: 0, p99: 0, ackFailures: 0 };
  }
  
  const totalTime = latencies.reduce((a, b) => a + b, 0);
  return {
    success: latencies.length,
    errors,
    ackFailures,
    throughput: Math.round(latencies.length / (totalTime / 1000)),
    p50: percentile(latencies, 50).toFixed(3),
    p99: percentile(latencies, 99).toFixed(3),
    p999: percentile(latencies, 99.9).toFixed(3),
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('     CONFIGURATION SWEEP BENCHMARK');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  const client = createClient({ url: CONFIG.masterUrl });
  await client.connect();
  
  // Store original config
  const origMinReplicas = await client.configGet('min-replicas-to-write');
  const origMaxLag = await client.configGet('min-replicas-max-lag');
  
  console.log(`📊 Original config: min-replicas=${origMinReplicas['min-replicas-to-write']}, max-lag=${origMaxLag['min-replicas-max-lag']}s\n`);
  
  // ─────────────────────────────────────────────────────────────────────
  // Part 1: min-replicas-to-write sweep
  // ─────────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  PART 1: min-replicas-to-write sweep (max-lag=10)');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  console.log('   min-replicas | Throughput | Success | Errors | p50(ms) | p99(ms)');
  console.log('   -------------|------------|---------|--------|---------|--------');
  
  for (const minReplicas of CONFIG.minReplicasSettings) {
    await setConfig(client, minReplicas, 10);
    await new Promise(r => setTimeout(r, 500)); // Let config settle
    
    const result = await benchmarkConfig(client, CONFIG.opsPerConfig, CONFIG.payloadSize);
    console.log(`   ${minReplicas.toString().padStart(12)} | ${result.throughput.toString().padStart(10)} | ${result.success.toString().padStart(7)} | ${result.errors.toString().padStart(6)} | ${result.p50.padStart(7)} | ${result.p99.padStart(7)}`);
  }
  
  // ─────────────────────────────────────────────────────────────────────
  // Part 2: min-replicas-max-lag sweep
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  PART 2: min-replicas-max-lag sweep (min-replicas=1)');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  console.log('   max-lag(s) | Throughput | Success | Errors | p50(ms) | p99(ms)');
  console.log('   -----------|------------|---------|--------|---------|--------');
  
  for (const maxLag of CONFIG.maxLagSettings) {
    await setConfig(client, 1, maxLag);
    await new Promise(r => setTimeout(r, 500));

    const result = await benchmarkConfig(client, CONFIG.opsPerConfig, CONFIG.payloadSize);
    console.log(`   ${maxLag.toString().padStart(10)} | ${result.throughput.toString().padStart(10)} | ${result.success.toString().padStart(7)} | ${result.errors.toString().padStart(6)} | ${result.p50.padStart(7)} | ${result.p99.padStart(7)}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Part 3: WAIT command comparison (application-level sync)
  // ─────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  PART 3: WAIT command (explicit synchronous writes)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Set config to allow all writes (test WAIT command overhead)
  await setConfig(client, 0, 10);
  await new Promise(r => setTimeout(r, 500));

  console.log('   WAIT replicas | Throughput | ACK Fails | p50(ms) | p99(ms) | p99.9(ms)');
  console.log('   --------------|------------|-----------|---------|---------|----------');

  for (const waitReplicas of [0, 1, 2]) {
    let result;
    if (waitReplicas === 0) {
      // No WAIT - just regular writes
      const latencies = [];
      const payload = generatePayload(CONFIG.payloadSize);
      for (let i = 0; i < CONFIG.opsPerConfig; i++) {
        const start = process.hrtime.bigint();
        await client.set(`nowait:${i}`, payload);
        latencies.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
      const totalTime = latencies.reduce((a, b) => a + b, 0);
      result = {
        throughput: Math.round(latencies.length / (totalTime / 1000)),
        ackFailures: 0,
        p50: percentile(latencies, 50).toFixed(3),
        p99: percentile(latencies, 99).toFixed(3),
        p999: percentile(latencies, 99.9).toFixed(3),
      };
    } else {
      result = await benchmarkWithWait(client, CONFIG.opsPerConfig, CONFIG.payloadSize, waitReplicas);
    }

    const label = waitReplicas === 0 ? 'None (async)' : waitReplicas.toString();
    console.log(`   ${label.padStart(14)} | ${result.throughput.toString().padStart(10)} | ${result.ackFailures.toString().padStart(9)} | ${result.p50.padStart(7)} | ${result.p99.padStart(7)} | ${result.p999.padStart(9)}`);
  }

  // Restore original config
  await setConfig(client,
    parseInt(origMinReplicas['min-replicas-to-write']),
    parseInt(origMaxLag['min-replicas-max-lag']));

  await client.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  CONFIG SWEEP COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);

