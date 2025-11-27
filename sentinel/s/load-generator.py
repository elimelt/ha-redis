#!/usr/bin/env python3
"""
Redis Load Generator with Sentinel Support
Generates configurable load on a Redis HA cluster
"""

import os
import time
import random
import string
import logging
from datetime import datetime
from redis.sentinel import Sentinel
from redis.exceptions import RedisError, ConnectionError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment variables
REDIS_SENTINELS = os.getenv('REDIS_SENTINELS', 'redis-sentinel-1:26379').split(',')
REDIS_MASTER_NAME = os.getenv('REDIS_MASTER_NAME', 'mymaster')
OPERATIONS_PER_SECOND = int(os.getenv('OPERATIONS_PER_SECOND', '100'))
READ_WRITE_RATIO = int(os.getenv('READ_WRITE_RATIO', '70'))  # Percentage of reads

# Parse sentinel addresses
sentinel_list = []
for sentinel_addr in REDIS_SENTINELS:
    host, port = sentinel_addr.strip().split(':')
    sentinel_list.append((host, int(port)))

logger.info(f"Connecting to Redis Sentinels: {sentinel_list}")
logger.info(f"Master name: {REDIS_MASTER_NAME}")
logger.info(f"Target operations per second: {OPERATIONS_PER_SECOND}")
logger.info(f"Read/Write ratio: {READ_WRITE_RATIO}% reads")


def generate_random_string(length=20):
    """Generate a random string of specified length"""
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))


def generate_random_key():
    """Generate a random key from a pool"""
    # Use a pool of 1000 keys to ensure some cache hits
    return f"key:{random.randint(1, 1000)}"


class LoadGenerator:
    def __init__(self):
        self.sentinel = None
        self.master = None
        self.slave = None
        self.stats = {
            'total_ops': 0,
            'successful_ops': 0,
            'failed_ops': 0,
            'reads': 0,
            'writes': 0,
            'last_report': time.time()
        }
        self.connect()

    def connect(self):
        """Connect to Redis via Sentinel"""
        max_retries = 10
        retry_delay = 5
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Attempting to connect to Sentinel (attempt {attempt + 1}/{max_retries})...")
                self.sentinel = Sentinel(
                    sentinel_list,
                    socket_timeout=5.0,
                    socket_connect_timeout=5.0
                )
                
                # Get master and slave connections
                self.master = self.sentinel.master_for(
                    REDIS_MASTER_NAME,
                    socket_timeout=5.0,
                    socket_connect_timeout=5.0
                )
                
                self.slave = self.sentinel.slave_for(
                    REDIS_MASTER_NAME,
                    socket_timeout=5.0,
                    socket_connect_timeout=5.0
                )
                
                # Test connection
                self.master.ping()
                logger.info("Successfully connected to Redis cluster!")
                return
                
            except Exception as e:
                logger.error(f"Connection attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    logger.info(f"Retrying in {retry_delay} seconds...")
                    time.sleep(retry_delay)
                else:
                    logger.error("Max retries reached. Exiting.")
                    raise

    def reconnect(self):
        """Reconnect to Redis in case of connection loss"""
        logger.warning("Connection lost. Attempting to reconnect...")
        time.sleep(2)
        self.connect()

    def perform_write(self):
        """Perform a write operation"""
        try:
            key = generate_random_key()
            value = generate_random_string()
            
            # Mix of different write operations
            op_type = random.choice(['set', 'incr', 'lpush', 'sadd', 'hset'])
            
            if op_type == 'set':
                self.master.set(key, value, ex=300)  # 5 minute expiry
            elif op_type == 'incr':
                self.master.incr(f"counter:{random.randint(1, 100)}")
            elif op_type == 'lpush':
                self.master.lpush(f"list:{random.randint(1, 50)}", value)
                self.master.ltrim(f"list:{random.randint(1, 50)}", 0, 99)  # Keep list size manageable
            elif op_type == 'sadd':
                self.master.sadd(f"set:{random.randint(1, 50)}", value)
            elif op_type == 'hset':
                self.master.hset(f"hash:{random.randint(1, 50)}", generate_random_string(10), value)
            
            self.stats['writes'] += 1
            self.stats['successful_ops'] += 1
            return True
            
        except (ConnectionError, RedisError) as e:
            logger.error(f"Write operation failed: {e}")
            self.stats['failed_ops'] += 1
            self.reconnect()
            return False

    def perform_read(self):
        """Perform a read operation"""
        try:
            key = generate_random_key()
            
            # Mix of different read operations
            op_type = random.choice(['get', 'exists', 'lrange', 'smembers', 'hgetall'])
            
            if op_type == 'get':
                self.slave.get(key)
            elif op_type == 'exists':
                self.slave.exists(key)
            elif op_type == 'lrange':
                self.slave.lrange(f"list:{random.randint(1, 50)}", 0, 10)
            elif op_type == 'smembers':
                self.slave.smembers(f"set:{random.randint(1, 50)}")
            elif op_type == 'hgetall':
                self.slave.hgetall(f"hash:{random.randint(1, 50)}")
            
            self.stats['reads'] += 1
            self.stats['successful_ops'] += 1
            return True
            
        except (ConnectionError, RedisError) as e:
            logger.error(f"Read operation failed: {e}")
            self.stats['failed_ops'] += 1
            self.reconnect()
            return False

    def report_stats(self):
        """Report statistics"""
        now = time.time()
        elapsed = now - self.stats['last_report']
        
        if elapsed >= 10:  # Report every 10 seconds
            ops_per_sec = self.stats['total_ops'] / elapsed if elapsed > 0 else 0
            success_rate = (self.stats['successful_ops'] / self.stats['total_ops'] * 100) if self.stats['total_ops'] > 0 else 0
            
            logger.info(
                f"Stats - Total: {self.stats['total_ops']}, "
                f"Success: {self.stats['successful_ops']}, "
                f"Failed: {self.stats['failed_ops']}, "
                f"Reads: {self.stats['reads']}, "
                f"Writes: {self.stats['writes']}, "
                f"Rate: {ops_per_sec:.2f} ops/sec, "
                f"Success Rate: {success_rate:.2f}%"
            )
            
            # Reset counters
            self.stats = {
                'total_ops': 0,
                'successful_ops': 0,
                'failed_ops': 0,
                'reads': 0,
                'writes': 0,
                'last_report': now
            }

    def run(self):
        """Main load generation loop"""
        logger.info("Starting load generation...")
        
        # Calculate sleep time between operations
        sleep_time = 1.0 / OPERATIONS_PER_SECOND if OPERATIONS_PER_SECOND > 0 else 0.01
        
        while True:
            try:
                # Decide whether to read or write based on ratio
                if random.randint(1, 100) <= READ_WRITE_RATIO:
                    self.perform_read()
                else:
                    self.perform_write()
                
                self.stats['total_ops'] += 1
                
                # Report stats periodically
                self.report_stats()
                
                # Sleep to maintain target rate
                time.sleep(sleep_time)
                
            except KeyboardInterrupt:
                logger.info("Shutting down load generator...")
                break
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                time.sleep(1)


if __name__ == '__main__':
    generator = LoadGenerator()
    generator.run()

