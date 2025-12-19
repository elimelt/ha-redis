/**
 * Failure Scenario Benchmark
 * 
 * Tests system behavior during replica failures and recovery
 */

const { createClient, createSentinel } = require('redis');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const CONFIG = {
  masterUrl: 'redis://localhost:6379',
  sentinelConfig: {
    name: 'mymaster',
    sentinelRootNodes: [
      { host: 'localhost', port: 26379 },
      { host: 'localhost', port: 26380 },
      { host: 'localhost', port: 26381 }
    ]
  },
  writeIntervalMs: 50,
  testDurationMs: 30000,
};

class FailureScenarioBenchmark {
  constructor() {
    this.results = {
      writes: { success: 0, failed: 0, latencies: [] },
      errors: [],
      events: [],
      replicaStates: []
    };
    this.running = false;
    this.counter = 0;
  }

  log(msg) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${msg}`);
    this.results.events.push({ ts, msg });
  }

  async dockerCommand(cmd) {
    try {
      const { stdout } = await execAsync(cmd);
      return stdout.trim();
    } catch (err) {
      return err.message;
    }
  }

  async getReplicaInfo(client) {
    try {
      const info = await client.info('replication');
      const connected = info.match(/connected_slaves:(\d+)/)?.[1] || '0';
      const goodSlaves = info.match(/min_slaves_good_slaves:(\d+)/)?.[1] || '0';
      return { connected: parseInt(connected), good: parseInt(goodSlaves) };
    } catch {
      return { connected: -1, good: -1 };
    }
  }

  async writeLoop(client) {
    while (this.running) {
      const key = `failure:test:${this.counter++}`;
      const start = process.hrtime.bigint();
      
      try {
        await client.set(key, `value-${Date.now()}`);
        const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
        this.results.writes.success++;
        this.results.writes.latencies.push(latencyMs);
      } catch (err) {
        this.results.writes.failed++;
        this.results.errors.push({ 
          counter: this.counter, 
          error: err.message.substring(0, 100),
          ts: Date.now()
        });
      }
      
      await new Promise(r => setTimeout(r, CONFIG.writeIntervalMs));
    }
  }

  async monitorLoop(client) {
    while (this.running) {
      const info = await this.getReplicaInfo(client);
      this.results.replicaStates.push({
        ts: Date.now(),
        connected: info.connected,
        good: info.good
      });
      await new Promise(r => setTimeout(r, 500));
    }
  }

  async runScenario1_ReplicaPause() {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('  SCENARIO 1: Replica Pause (Simulating Network Partition)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    const client = createClient({ url: CONFIG.masterUrl });
    await client.connect();
    
    this.running = true;
    this.results = { writes: { success: 0, failed: 0, latencies: [] }, errors: [], events: [], replicaStates: [] };
    
    // Start write and monitor loops
    const writePromise = this.writeLoop(client);
    const monitorPromise = this.monitorLoop(client);
    
    this.log('Started continuous writes');
    await new Promise(r => setTimeout(r, 3000));
    
    this.log('Pausing redis-replica-1...');
    await this.dockerCommand('docker pause redis-replica-1');
    await new Promise(r => setTimeout(r, 5000));
    
    this.log('Checking write availability with 1 replica paused...');
    await new Promise(r => setTimeout(r, 3000));
    
    this.log('Pausing redis-replica-2...');
    await this.dockerCommand('docker pause redis-replica-2');
    
    this.log('Waiting for min-replicas-max-lag timeout (10s + buffer)...');
    await new Promise(r => setTimeout(r, 15000));
    
    this.log('Unpausing redis-replica-1...');
    await this.dockerCommand('docker unpause redis-replica-1');
    await new Promise(r => setTimeout(r, 3000));
    
    this.log('Unpausing redis-replica-2...');
    await this.dockerCommand('docker unpause redis-replica-2');
    await new Promise(r => setTimeout(r, 3000));
    
    this.running = false;
    await Promise.all([writePromise, monitorPromise]);
    await client.disconnect();
    
    this.printResults('Replica Pause Scenario');
  }

  async runScenario2_ReplicaStop() {
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('  SCENARIO 2: Replica Stop/Start');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    const client = createClient({ url: CONFIG.masterUrl });
    await client.connect();
    
    this.running = true;
    this.results = { writes: { success: 0, failed: 0, latencies: [] }, errors: [], events: [], replicaStates: [] };
    
    const writePromise = this.writeLoop(client);
    const monitorPromise = this.monitorLoop(client);
    
    this.log('Started continuous writes');
    await new Promise(r => setTimeout(r, 3000));
    
    this.log('Stopping redis-replica-1...');
    await this.dockerCommand('docker stop redis-replica-1');
    await new Promise(r => setTimeout(r, 5000));
    
    this.log('Starting redis-replica-1...');
    await this.dockerCommand('docker start redis-replica-1');
    await new Promise(r => setTimeout(r, 5000));

    this.running = false;
    await Promise.all([writePromise, monitorPromise]);
    await client.disconnect();

    this.printResults('Replica Stop/Start Scenario');
  }

  printResults(scenarioName) {
    const { writes, errors, replicaStates } = this.results;

    console.log(`\n📊 Results for: ${scenarioName}`);
    console.log('─'.repeat(60));

    const total = writes.success + writes.failed;
    const successRate = ((writes.success / total) * 100).toFixed(2);

    console.log(`   Total writes attempted: ${total}`);
    console.log(`   Successful: ${writes.success} (${successRate}%)`);
    console.log(`   Failed: ${writes.failed} (${(100 - parseFloat(successRate)).toFixed(2)}%)`);

    if (writes.latencies.length > 0) {
      const sorted = [...writes.latencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      const avg = writes.latencies.reduce((a, b) => a + b, 0) / writes.latencies.length;

      console.log(`\n   Latency (successful writes):`);
      console.log(`      p50: ${p50.toFixed(3)}ms`);
      console.log(`      p99: ${p99.toFixed(3)}ms`);
      console.log(`      avg: ${avg.toFixed(3)}ms`);
    }

    // Analyze replica state transitions
    const transitions = [];
    for (let i = 1; i < replicaStates.length; i++) {
      if (replicaStates[i].connected !== replicaStates[i-1].connected) {
        transitions.push({
          from: replicaStates[i-1].connected,
          to: replicaStates[i].connected,
          ts: replicaStates[i].ts
        });
      }
    }

    if (transitions.length > 0) {
      console.log(`\n   Replica state transitions:`);
      transitions.forEach(t => {
        console.log(`      ${t.from} → ${t.to} replicas`);
      });
    }

    // Show error distribution
    if (errors.length > 0) {
      const errorTypes = {};
      errors.forEach(e => {
        const key = e.error.substring(0, 50);
        errorTypes[key] = (errorTypes[key] || 0) + 1;
      });

      console.log(`\n   Error types:`);
      Object.entries(errorTypes).forEach(([type, count]) => {
        console.log(`      ${type}: ${count}`);
      });
    }

    console.log('\n');
  }
}

// Run scenarios
async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('     FAILURE SCENARIO BENCHMARK');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const benchmark = new FailureScenarioBenchmark();

  // Ensure clean state
  console.log('🔄 Ensuring clean cluster state...');
  await benchmark.dockerCommand('docker unpause redis-replica-1 2>/dev/null || true');
  await benchmark.dockerCommand('docker unpause redis-replica-2 2>/dev/null || true');
  await benchmark.dockerCommand('docker start redis-replica-1 2>/dev/null || true');
  await benchmark.dockerCommand('docker start redis-replica-2 2>/dev/null || true');
  await new Promise(r => setTimeout(r, 3000));

  await benchmark.runScenario1_ReplicaPause();

  // Clean up between scenarios
  await benchmark.dockerCommand('docker unpause redis-replica-1 2>/dev/null || true');
  await benchmark.dockerCommand('docker unpause redis-replica-2 2>/dev/null || true');
  await new Promise(r => setTimeout(r, 3000));

  await benchmark.runScenario2_ReplicaStop();

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  FAILURE SCENARIOS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
