"""
Tests for all ML models: build, train, predict shapes.
Uses a small synthetic dataset for fast execution.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import numpy as np

from models import ModelFactory
from models import EnsembleModel


def _synthetic_data(samples=200, lookback=30, features=12):
    """Generate synthetic time-series data for testing."""
    X = np.random.randn(samples, lookback, features).astype(np.float32)
    y = np.random.randn(samples).astype(np.float32)
    return X[:160], X[160:], y[:160], y[160:]


class TestModelFactory:
    def test_list_models(self):
        models = ModelFactory.list_models()
        assert len(models) == 6
        assert "lstm" in models
        assert "transformer" in models

    def test_create_invalid(self):
        with pytest.raises(ValueError):
            ModelFactory.create("nonexistent_model")

    def test_create_all(self):
        models = ModelFactory.create_all()
        assert len(models) == 6


class TestAllModels:
    """Parametrized tests — each model is tested identically."""

    @pytest.fixture(params=ModelFactory.list_models())
    def model_name(self, request):
        return request.param

    def test_build_train_predict(self, model_name):
        X_train, X_test, y_train, y_test = _synthetic_data()
        model = ModelFactory.create(model_name)

        input_shape = (X_train.shape[1], X_train.shape[2])
        model.build(input_shape)

        # Train with minimal epochs for speed
        history = model.train(X_train, y_train, epochs=2, batch_size=32, validation_split=0.1)
        assert "loss" in history

        preds = model.predict(X_test)
        assert preds.shape == (len(X_test),)
        assert not np.isnan(preds).any()


class TestEnsemble:
    def test_ensemble_from_ranked(self):
        X_train, X_test, y_train, y_test = _synthetic_data()
        input_shape = (X_train.shape[1], X_train.shape[2])

        models_with_rmse = []
        for name in ["lstm", "gru"]:
            m = ModelFactory.create(name)
            m.build(input_shape)
            m.train(X_train, y_train, epochs=2, batch_size=32, validation_split=0.1)
            rmse = float(np.sqrt(np.mean((m.predict(X_test) - y_test) ** 2)))
            models_with_rmse.append((m, rmse))

        ensemble = EnsembleModel.from_ranked(models_with_rmse)
        preds = ensemble.predict(X_test)
        assert preds.shape == (len(X_test),)
