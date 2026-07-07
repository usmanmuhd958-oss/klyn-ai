#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "Generating cloud deployment files..."

# Dockerfile
cat > Dockerfile << 'DOCKERFILE'
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000 4000 9090
CMD ["node", "api/server.js"]
DOCKERFILE

# fly.toml (for Fly.io)
cat > fly.toml << 'FLYTOM'
app = "klyn-ai-os"
kill_signal = "SIGINT"
kill_timeout = 5
[env]
  PORT = "3000"
FLYTOM

echo "Deploy to Fly.io: fly launch"
echo "Or build Docker: docker build -t klyn-os ."
