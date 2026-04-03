"""
Prediction service — orchestrates data fetch → feature engineering → model training → prediction.
Why: Single entry point for the full prediction pipeline; coordinates data/model/domain layers.
"""

from datetime import datetime, timedelta
from typing import Optional

import numpy as np

from data import DataFetcher
from data import DataPreprocessor
from data import FeatureEngineer
from models import BaseModel
from models import ModelFactory
from domain import Prediction
from utils import LoggerFactory
from importlib import import_module as _im
config = _im('01_config').config

log = LoggerFactory.get("services.prediction")


class PredictionService:
    """Runs the full pipeline for a single model on a single stock."""

    def __init__(self):
        self.fetcher = DataFetcher()
        self.preprocessor = DataPreprocessor()
        self.engineer = FeatureEngineer()

    def prepare_data(self, symbol: str, period: str = "2y"):
        """Fetch, engineer features, scale, create sequences, split."""
        raw_df = self.fetcher.fetch(symbol, period)
        featured_df = self.engineer.add_all_features(raw_df)

        scaled_features, scaled_target = self.preprocessor.scale(
            featured_df, target_col=config.data.target
        )
        X, y = self.preprocessor.create_sequences(
            scaled_features, scaled_target, lookback=config.model.lookback
        )
        X_train, X_test, y_train, y_test = self.preprocessor.split(
            X, y, train_ratio=config.data.train_split
        )
        return X_train, X_test, y_train, y_test

    def train_and_predict(
        self,
        model: BaseModel,
        X_train: np.ndarray,
        X_test: np.ndarray,
        y_train: np.ndarray,
    ) -> np.ndarray:
        """Build, train, and produce predictions (in scaled space)."""
        input_shape = (X_train.shape[1], X_train.shape[2])
        model.build(input_shape)
        model.train(
            X_train, y_train,
            epochs=config.model.epochs,
            batch_size=config.model.batch_size,
            validation_split=config.model.validation_split,
        )
        scaled_preds = model.predict(X_test)
        return scaled_preds

    def predict_next_day(
        self,
        symbol: str,
        model_name: str = "lstm",
        period: str = "2y",
    ) -> Prediction:
        """Full pipeline: data → model → next-day price prediction."""
        log.info(f"Predicting next day for {symbol} using {model_name}")

        raw_df = self.fetcher.fetch(symbol, period)
        featured_df = self.engineer.add_all_features(raw_df)

        scaled_features, scaled_target = self.preprocessor.scale(
            featured_df, target_col=config.data.target
        )

        # Use last `lookback` days as input
        last_sequence = scaled_features[-config.model.lookback :]
        last_sequence = last_sequence.reshape(1, config.model.lookback, -1)

        # Build and train on all available data
        X, y = self.preprocessor.create_sequences(
            scaled_features, scaled_target, lookback=config.model.lookback
        )
        model = ModelFactory.create(model_name)
        input_shape = (X.shape[1], X.shape[2])
        model.build(input_shape)
        model.train(
            X, y,
            epochs=config.model.epochs,
            batch_size=config.model.batch_size,
            validation_split=config.model.validation_split,
        )

        # Predict
        scaled_pred = model.predict(last_sequence)
        predicted_price = self.preprocessor.inverse_transform_target(scaled_pred)[0]

        # Confidence based on recent validation loss
        history = model.training_history
        final_val_loss = history.get("val_loss", [1.0])[-1]
        confidence = max(0.0, 1.0 - final_val_loss)

        return Prediction(
            symbol=symbol,
            model_name=model.name,
            predicted_price=float(predicted_price),
            prediction_date=datetime.now() + timedelta(days=1),
            confidence=confidence,
        )
