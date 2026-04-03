#!/usr/bin/env bash
# Setup script — creates venv and installs dependencies.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "📦 Setting up FinResearcher..."

cd "$PROJECT_ROOT"

# Create virtual environment
if [ ! -d ".venv" ]; then
    echo "🐍 Creating virtual environment..."
    python3 -m venv .venv
fi

echo "📥 Installing dependencies..."
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Copy env if not exists
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "📄 Created .env from .env.example"
fi

echo "✅ Setup complete!"
echo ""
echo "Activate with: source .venv/bin/activate"
echo "Run UI:        streamlit run src/ui/00_app.py"
echo "Run API:       cd src && uvicorn 00_main:app --reload"
