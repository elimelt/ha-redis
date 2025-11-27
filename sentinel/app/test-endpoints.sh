#!/bin/bash

# Test script for Redis HA Express Application
# Usage: ./test-endpoints.sh [base_url]

BASE_URL=${1:-http://localhost:3000}

echo "Testing Redis HA Express Application"
echo "Base URL: $BASE_URL"
echo "========================================"
echo ""

# Health check
echo "1. Health Check"
curl -s "$BASE_URL/health" | jq '.'
echo ""
echo ""

# Set a value
echo "2. SET operation"
curl -s -X POST "$BASE_URL/set" \
  -H "Content-Type: application/json" \
  -d '{"key": "test:1", "value": "Hello Redis!", "ttl": 300}' | jq '.'
echo ""
echo ""

# Get the value
echo "3. GET operation"
curl -s "$BASE_URL/get/test:1" | jq '.'
echo ""
echo ""

# Increment a counter
echo "4. INCR operation"
curl -s -X POST "$BASE_URL/incr" \
  -H "Content-Type: application/json" \
  -d '{"key": "counter:test"}' | jq '.'
echo ""
echo ""

# Check if key exists
echo "5. EXISTS operation"
curl -s "$BASE_URL/exists/test:1" | jq '.'
echo ""
echo ""

# Add to list
echo "6. LPUSH operation"
curl -s -X POST "$BASE_URL/lpush" \
  -H "Content-Type: application/json" \
  -d '{"key": "list:test", "value": "item1"}' | jq '.'
echo ""
echo ""

# Get list range
echo "7. LRANGE operation"
curl -s "$BASE_URL/lrange/list:test?start=0&stop=10" | jq '.'
echo ""
echo ""

# Add to set
echo "8. SADD operation"
curl -s -X POST "$BASE_URL/sadd" \
  -H "Content-Type: application/json" \
  -d '{"key": "set:test", "value": "member1"}' | jq '.'
echo ""
echo ""

# Get set members
echo "9. SMEMBERS operation"
curl -s "$BASE_URL/smembers/set:test" | jq '.'
echo ""
echo ""

# Add to hash
echo "10. HSET operation"
curl -s -X POST "$BASE_URL/hset" \
  -H "Content-Type: application/json" \
  -d '{"key": "hash:test", "field": "name", "value": "Redis HA"}' | jq '.'
echo ""
echo ""

# Get hash
echo "11. HGETALL operation"
curl -s "$BASE_URL/hgetall/hash:test" | jq '.'
echo ""
echo ""

# Generate load
echo "12. Load Generation (100 operations, 70% reads)"
curl -s -X POST "$BASE_URL/load" \
  -H "Content-Type: application/json" \
  -d '{"operations": 100, "readWriteRatio": 70}' | jq '.'
echo ""
echo ""

# View statistics
echo "13. Statistics"
curl -s "$BASE_URL/stats" | jq '.'
echo ""
echo ""

echo "========================================"
echo "All tests completed!"

