#!/usr/bin/env bash
# Build Docker image.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "🐳 Building Docker image..."
docker build -t finresearcher:latest .

echo "✅ Build complete! Run with:"
echo "  docker run -p 8501:8501 finresearcher:latest"
