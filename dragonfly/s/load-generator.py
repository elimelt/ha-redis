#!/usr/bin/env python3
"""
Load generator for DragonflyDB HA setup.
Generates continuous load with configurable read/write ratio.
"""

import os
import time
import random
import string
from redis import Redis
from redis.exceptions import RedisError

# Configuration from environment variables
PRIMARY_HOST = os.getenv('DRAGONFLY_PRIMARY', 'dragonfly-primary:6379')
REPLICA_1_HOST = os.getenv('DRAGONFLY_REPLICA_1', 'dragonfly-replica-1:6380')
REPLICA_2_HOST = os.getenv('DRAGONFLY_REPLICA_2', 'dragonfly-replica-2:6381')
OPERATIONS_PER_SECOND = int(os.getenv('OPERATIONS_PER_SECOND', '100'))
READ_WRITE_RATIO = int(os.getenv('READ_WRITE_RATIO', '70'))  # % reads

# Parse connection strings
def parse_host(host_str):
    parts = host_str.split(':')
    return parts[0], int(parts[1]) if len(parts) > 1 else 6379

primary_host, primary_port = parse_host(PRIMARY_HOST)
replica_1_host, replica_1_port = parse_host(REPLICA_1_HOST)
replica_2_host, replica_2_port = parse_host(REPLICA_2_HOST)

print(f"Connecting to Dragonfly primary: {primary_host}:{primary_port}")
print(f"Connecting to Dragonfly replica 1: {replica_1_host}:{replica_1_port}")
print(f"Connecting to Dragonfly replica 2: {replica_2_host}:{replica_2_port}")

# Create Redis clients
primary_client = Redis(
    host=primary_host,
    port=primary_port,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=5,
    retry_on_timeout=True
)

replica_1_client = Redis(
    host=replica_1_host,
    port=replica_1_port,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=5,
    retry_on_timeout=True
)

replica_2_client = Redis(
    host=replica_2_host,
    port=replica_2_port,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=5,
    retry_on_timeout=True
)

# Wait for connections
max_retries = 30
for i in range(max_retries):
    try:
        primary_client.ping()
        replica_1_client.ping()
        replica_2_client.ping()
        print("Connected to all Dragonfly instances")
        break
    except RedisError as e:
        if i < max_retries - 1:
            print(f"Waiting for Dragonfly instances to be ready... ({i+1}/{max_retries})")
            time.sleep(2)
        else:
            print(f"Failed to connect to Dragonfly instances: {e}")
            raise

# Helper functions
def generate_random_string(length=20):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def generate_random_key():
    # Use a pool of 1000 keys to ensure some cache hits
    return f"key:{random.randint(1, 1000)}"

def get_random_int(min_val, max_val):
    return random.randint(min_val, max_val)

# Statistics
stats = {
    'total_operations': 0,
    'successful_operations': 0,
    'failed_operations': 0,
    'reads': 0,
    'writes': 0,
    'read_errors': 0,
    'write_errors': 0
}

last_report_time = time.time()
report_interval = 10  # seconds

def print_stats():
    elapsed = time.time() - last_report_time
    ops_per_sec = stats['total_operations'] / elapsed if elapsed > 0 else 0
    success_rate = (stats['successful_operations'] / stats['total_operations'] * 100) if stats['total_operations'] > 0 else 0
    
    print(f"\n--- Statistics (last {report_interval}s) ---")
    print(f"Operations: {stats['total_operations']} ({ops_per_sec:.2f} ops/sec)")
    print(f"Success rate: {success_rate:.2f}%")
    print(f"Reads: {stats['reads']} (errors: {stats['read_errors']})")
    print(f"Writes: {stats['writes']} (errors: {stats['write_errors']})")
    print("---\n")
    
    # Reset stats
    for key in stats:
        stats[key] = 0

# Main load generation loop
print(f"\nStarting load generation:")
print(f"  Operations per second: {OPERATIONS_PER_SECOND}")
print(f"  Read/Write ratio: {READ_WRITE_RATIO}% reads\n")

sleep_time = 1.0 / OPERATIONS_PER_SECOND

while True:
    try:
        # Determine if this should be a read or write operation
        is_read = random.randint(1, 100) <= READ_WRITE_RATIO
        
        if is_read:
            # Read operation - use one of the replicas randomly
            client = random.choice([replica_1_client, replica_2_client])
            stats['reads'] += 1
            
            # Random read operation
            op_type = random.choice(['get', 'exists', 'lrange', 'smembers', 'hgetall'])
            
            try:
                if op_type == 'get':
                    client.get(generate_random_key())
                elif op_type == 'exists':
                    client.exists(generate_random_key())
                elif op_type == 'lrange':
                    client.lrange(f"list:{get_random_int(1, 50)}", 0, 10)
                elif op_type == 'smembers':
                    client.smembers(f"set:{get_random_int(1, 50)}")
                elif op_type == 'hgetall':
                    client.hgetall(f"hash:{get_random_int(1, 50)}")
                
                stats['successful_operations'] += 1
            except RedisError as e:
                stats['failed_operations'] += 1
                stats['read_errors'] += 1
                
        else:
            # Write operation - use primary
            client = primary_client
            stats['writes'] += 1
            
            # Random write operation
            op_type = random.choice(['set', 'incr', 'lpush', 'sadd', 'hset'])
            
            try:
                if op_type == 'set':
                    client.setex(generate_random_key(), 300, generate_random_string())
                elif op_type == 'incr':
                    client.incr(f"counter:{get_random_int(1, 100)}")
                elif op_type == 'lpush':
                    list_key = f"list:{get_random_int(1, 50)}"
                    client.lpush(list_key, generate_random_string())
                    client.ltrim(list_key, 0, 99)
                elif op_type == 'sadd':
                    client.sadd(f"set:{get_random_int(1, 50)}", generate_random_string())
                elif op_type == 'hset':
                    client.hset(f"hash:{get_random_int(1, 50)}", generate_random_string(10), generate_random_string())
                
                stats['successful_operations'] += 1
            except RedisError as e:
                stats['failed_operations'] += 1
                stats['write_errors'] += 1
        
        stats['total_operations'] += 1
        
        # Print statistics periodically
        if time.time() - last_report_time >= report_interval:
            print_stats()
            last_report_time = time.time()
        
        # Sleep to maintain desired operations per second
        time.sleep(sleep_time)
        
    except KeyboardInterrupt:
        print("\nStopping load generator...")
        print_stats()
        break
    except Exception as e:
        print(f"Unexpected error: {e}")
        time.sleep(1)

