"""
Tests for data pipeline: fetcher, preprocessor, feature engineering.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import numpy as np
import pandas as pd

from data import DataFetcher
from data import DataPreprocessor
from data import FeatureEngineer


class TestDataFetcher:
    def test_fetch_returns_dataframe(self):
        df = DataFetcher.fetch("AAPL", period="3mo")
        assert isinstance(df, pd.DataFrame)
        assert len(df) > 0
        assert "Close" in df.columns
        assert "Volume" in df.columns

    def test_fetch_invalid_symbol(self):
        with pytest.raises(ValueError):
            DataFetcher.fetch("ZZZZZZZZZZ", period="1mo")

    def test_get_info(self):
        info = DataFetcher.get_info("AAPL")
        assert "name" in info
        assert "sector" in info


class TestFeatureEngineer:
    @pytest.fixture
    def sample_df(self):
        return DataFetcher.fetch("AAPL", period="1y")

    def test_adds_features(self, sample_df):
        result = FeatureEngineer.add_all_features(sample_df)
        expected_cols = ["SMA_5", "SMA_20", "RSI_14", "MACD", "BB_Upper", "Returns"]
        for col in expected_cols:
            assert col in result.columns, f"Missing feature: {col}"

    def test_no_nans_after_engineering(self, sample_df):
        result = FeatureEngineer.add_all_features(sample_df)
        assert not result.isnull().any().any()


class TestPreprocessor:
    @pytest.fixture
    def preprocessed_data(self):
        df = DataFetcher.fetch("AAPL", period="1y")
        df = FeatureEngineer.add_all_features(df)
        return df

    def test_scaling(self, preprocessed_data):
        pp = DataPreprocessor()
        features, target = pp.scale(preprocessed_data, "Close")
        assert features.min() >= 0
        assert features.max() <= 1
        assert target.min() >= 0
        assert target.max() <= 1

    def test_sequence_creation(self, preprocessed_data):
        pp = DataPreprocessor()
        features, target = pp.scale(preprocessed_data, "Close")
        X, y = pp.create_sequences(features, target, lookback=30)
        assert X.shape[0] == y.shape[0]
        assert X.shape[1] == 30  # lookback
        assert X.shape[2] == features.shape[1]

    def test_inverse_transform(self, preprocessed_data):
        pp = DataPreprocessor()
        _, target = pp.scale(preprocessed_data, "Close")
        original = preprocessed_data["Close"].values
        reconstructed = pp.inverse_transform_target(target)
        np.testing.assert_allclose(reconstructed, original, rtol=1e-5)

    def test_split_preserves_order(self, preprocessed_data):
        pp = DataPreprocessor()
        features, target = pp.scale(preprocessed_data, "Close")
        X, y = pp.create_sequences(features, target, lookback=30)
        X_train, X_test, y_train, y_test = pp.split(X, y, 0.8)

        total = len(X_train) + len(X_test)
        assert total == len(X)
