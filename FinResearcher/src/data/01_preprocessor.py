"""
Data preprocessor: scaling, splitting, sequence creation.
Why: Separates data transformation from fetching and feature engineering.
"""

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from typing import Tuple

from utils import LoggerFactory

log = LoggerFactory.get("data.preprocessor")


class DataPreprocessor:
    """Handles scaling, train/test splitting, and sequence creation."""

    def __init__(self):
        self.scaler = MinMaxScaler(feature_range=(0, 1))
        self.target_scaler = MinMaxScaler(feature_range=(0, 1))

    def scale(self, df: pd.DataFrame, target_col: str = "Close") -> Tuple[np.ndarray, np.ndarray]:
        """
        Scale features and target separately.
        Returns (scaled_features, scaled_target).
        """
        features = df.drop(columns=[target_col]).values
        target = df[[target_col]].values

        scaled_features = self.scaler.fit_transform(features)
        scaled_target = self.target_scaler.fit_transform(target)

        log.info(f"Scaled {scaled_features.shape[1]} features + 1 target")
        return scaled_features, scaled_target

    def create_sequences(
        self,
        features: np.ndarray,
        target: np.ndarray,
        lookback: int = 60,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Create sliding-window sequences for time-series models.
        X shape: (samples, lookback, num_features)
        y shape: (samples,)
        """
        X, y = [], []
        for i in range(lookback, len(features)):
            X.append(features[i - lookback : i])
            y.append(target[i, 0])

        X = np.array(X)
        y = np.array(y)
        log.info(f"Created {len(X)} sequences with lookback={lookback}")
        return X, y

    def split(
        self,
        X: np.ndarray,
        y: np.ndarray,
        train_ratio: float = 0.8,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Split into train/test sets chronologically (no shuffling)."""
        split_idx = int(len(X) * train_ratio)
        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]
        log.info(f"Split: train={len(X_train)}, test={len(X_test)}")
        return X_train, X_test, y_train, y_test

    def inverse_transform_target(self, scaled: np.ndarray) -> np.ndarray:
        """Convert scaled target values back to original price scale."""
        if scaled.ndim == 1:
            scaled = scaled.reshape(-1, 1)
        return self.target_scaler.inverse_transform(scaled).flatten()
