"""
Tests for the metrics utility and backtest service.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import numpy as np

from utils import compute_metrics
from services import BacktestService


class TestMetrics:
    def test_perfect_predictions(self):
        y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        m = compute_metrics(y, y)
        assert m.mae == 0.0
        assert m.mse == 0.0
        assert m.rmse == 0.0
        assert m.r2 == 1.0

    def test_known_values(self):
        y_true = np.array([3.0, -0.5, 2.0, 7.0])
        y_pred = np.array([2.5, 0.0, 2.0, 8.0])
        m = compute_metrics(y_true, y_pred)
        assert m.mae == pytest.approx(0.5, rel=1e-4)
        assert m.rmse == pytest.approx(np.sqrt(0.375), rel=1e-4)

    def test_directional_accuracy(self):
        y_true = np.array([1.0, 2.0, 3.0, 2.0, 1.0])
        y_pred = np.array([1.0, 2.1, 3.1, 1.9, 0.9])  # perfect direction
        m = compute_metrics(y_true, y_pred)
        assert m.directional_accuracy == 100.0


class TestBacktest:
    def test_basic_backtest(self):
        actual = np.array([100, 102, 101, 105, 103, 107, 110])
        predicted = np.array([100, 103, 100, 106, 102, 108, 111])
        result = BacktestService.run(actual, predicted, 10000.0)

        assert result.initial_capital == 10000.0
        assert result.final_capital > 0
        assert isinstance(result.sharpe_ratio, float)
        assert result.max_drawdown_pct >= 0

    def test_always_up_prediction(self):
        actual = np.linspace(100, 150, 50)
        predicted = np.linspace(100, 155, 50)  # always predicts up
        result = BacktestService.run(actual, predicted, 10000.0)
        assert result.total_return_pct > 0  # should profit in bull market
