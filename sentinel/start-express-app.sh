#!/bin/bash

# Quick start script for the Express.js Redis HA application

set -e

echo "========================================="
echo "Redis HA Express Application Quick Start"
echo "========================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Please start Docker first."
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Start the services
echo "🚀 Starting Redis HA cluster and Express application..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check health
echo ""
echo "🏥 Checking application health..."
if curl -s http://localhost:3000/health | grep -q "healthy"; then
    echo "✅ Express application is healthy!"
else
    echo "⚠️  Express application may not be ready yet. Checking logs..."
    docker logs redis-express-app --tail 20
fi

echo ""
echo "========================================="
echo "✨ Setup Complete!"
echo "========================================="
echo ""
echo "📊 Web Dashboard: http://localhost:3000"
echo "📡 API Endpoint:  http://localhost:3000/health"
echo ""
echo "Quick Commands:"
echo "  • View logs:        docker logs -f redis-express-app"
echo "  • Check status:     curl http://localhost:3000/health"
echo "  • View stats:       curl http://localhost:3000/stats"
echo "  • Test endpoints:   ./app/test-endpoints.sh"
echo "  • Stop services:    docker-compose down"
echo ""
echo "📖 For more information, see EXPRESS_APP_GUIDE.md"
echo ""

