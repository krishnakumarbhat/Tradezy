"""
Ensemble model — weighted combination of the best individual models.
Why: Reduces variance by averaging predictions from diverse architectures;
typically outperforms any single model.
"""

import numpy as np
from typing import List, Tuple

from models import BaseModel
from utils import LoggerFactory

log = LoggerFactory.get("models.ensemble")


class EnsembleModel(BaseModel):
    """
    Weighted ensemble of trained sub-models.
    Weights are inversely proportional to each model's RMSE on validation data.
    """

    def __init__(self):
        super().__init__("Ensemble")
        self._sub_models: List[Tuple[BaseModel, float]] = []

    def add_model(self, model: BaseModel, weight: float) -> None:
        self._sub_models.append((model, weight))

    @staticmethod
    def from_ranked(models_with_rmse: List[Tuple[BaseModel, float]]) -> "EnsembleModel":
        """Create ensemble with weights inversely proportional to RMSE."""
        ensemble = EnsembleModel()

        # Inverse-RMSE weighting: lower RMSE → higher weight
        inv_rmses = [1.0 / rmse if rmse > 0 else 1.0 for _, rmse in models_with_rmse]
        total = sum(inv_rmses)
        weights = [w / total for w in inv_rmses]

        for (model, rmse), weight in zip(models_with_rmse, weights):
            ensemble.add_model(model, weight)
            log.info(f"  {model.name}: weight={weight:.4f} (RMSE={rmse:.6f})")

        log.info(f"Ensemble built with {len(models_with_rmse)} models")
        return ensemble

    def build(self, input_shape: tuple) -> None:
        # Ensemble doesn't build its own architecture
        pass

    def train(self, X_train, y_train, epochs=50, batch_size=32, validation_split=0.1):
        # Sub-models are already trained
        return {}

    def predict(self, X: np.ndarray) -> np.ndarray:
        if not self._sub_models:
            raise RuntimeError("No sub-models in ensemble")

        predictions = np.zeros(len(X))
        for model, weight in self._sub_models:
            pred = model.predict(X)
            predictions += weight * pred

        return predictions

    def summary(self) -> str:
        lines = [f"Ensemble with {len(self._sub_models)} models:"]
        for model, weight in self._sub_models:
            lines.append(f"  {model.name}: weight={weight:.4f}")
        return "\n".join(lines)
