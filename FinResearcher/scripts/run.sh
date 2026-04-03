#!/usr/bin/env bash
# Run the Streamlit UI and optionally the FastAPI backend.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"
source .venv/bin/activate

MODE="${1:-ui}"

case "$MODE" in
    ui)
        echo "🚀 Starting Streamlit dashboard..."
        streamlit run src/ui/00_app.py --server.port=8501
        ;;
    api)
        echo "🚀 Starting FastAPI server..."
        cd src
        uvicorn 00_main:app --host 0.0.0.0 --port 8000 --reload
        ;;
    both)
        echo "🚀 Starting both API and UI..."
        cd src
        uvicorn 00_main:app --host 0.0.0.0 --port 8000 --reload &
        cd "$PROJECT_ROOT"
        streamlit run src/ui/00_app.py --server.port=8501
        ;;
    *)
        echo "Usage: $0 {ui|api|both}"
        exit 1
        ;;
esac
