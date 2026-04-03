"""
Domain models for stock data and predictions.
Why: Clean separation of domain entities from infrastructure concerns.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional


@dataclass
class StockData:
    symbol: str
    date: datetime
    open_price: float
    high_price: float
    low_price: float
    close_price: float
    volume: int


@dataclass
class Prediction:
    symbol: str
    model_name: str
    predicted_price: float
    prediction_date: datetime
    confidence: float = 0.0
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "model_name": self.model_name,
            "predicted_price": round(self.predicted_price, 2),
            "prediction_date": self.prediction_date.isoformat(),
            "confidence": round(self.confidence, 4),
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class ModelResult:
    """Stores a trained model's evaluation results."""
    model_name: str
    mae: float
    mse: float
    rmse: float
    mape: float
    r2: float
    directional_accuracy: float
    training_loss: List[float] = field(default_factory=list)
    validation_loss: List[float] = field(default_factory=list)
    predictions: Optional[list] = None
    actual_values: Optional[list] = None

    def to_dict(self) -> dict:
        return {
            "model_name": self.model_name,
            "mae": round(self.mae, 6),
            "mse": round(self.mse, 6),
            "rmse": round(self.rmse, 6),
            "mape": round(self.mape, 4),
            "r2": round(self.r2, 4),
            "directional_accuracy": round(self.directional_accuracy, 4),
        }


@dataclass
class ComparisonReport:
    """Full comparison of all models on a given stock."""
    symbol: str
    period: str
    results: List[ModelResult]
    best_model: str
    ensemble_result: Optional[ModelResult] = None
    timestamp: datetime = field(default_factory=datetime.now)

    def ranking(self) -> List[ModelResult]:
        """Rank models by RMSE (lower is better)."""
        return sorted(self.results, key=lambda r: r.rmse)

    def to_dict(self) -> dict:
        ranked = self.ranking()
        return {
            "symbol": self.symbol,
            "period": self.period,
            "best_model": self.best_model,
            "timestamp": self.timestamp.isoformat(),
            "rankings": [r.to_dict() for r in ranked],
            "ensemble": self.ensemble_result.to_dict() if self.ensemble_result else None,
        }
