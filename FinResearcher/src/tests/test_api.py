"""
Tests for FastAPI endpoints.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import importlib
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

_routes = importlib.import_module("api.00_routes")
app = FastAPI()
app.include_router(_routes.router)
client = TestClient(app)


class TestHealthEndpoint:
    def test_health(self):
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert len(data["available_models"]) == 6


class TestStockInfoEndpoint:
    def test_valid_symbol(self):
        resp = client.get("/api/v1/stock/AAPL")
        assert resp.status_code == 200
        data = resp.json()
        assert "name" in data
        assert "sector" in data
