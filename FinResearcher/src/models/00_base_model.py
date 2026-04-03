"""
Abstract base class for all prediction models.
Why: Enforces a consistent interface so the Factory and EvaluationService
can treat every model identically (Strategy pattern).
"""

from abc import ABC, abstractmethod
from typing import Optional

import numpy as np


class BaseModel(ABC):
    """All prediction models must implement build, train, predict."""

    def __init__(self, name: str):
        self.name = name
        self._model = None
        self._history = None

    @abstractmethod
    def build(self, input_shape: tuple) -> None:
        """Construct the neural network architecture."""
        ...

    @abstractmethod
    def train(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        epochs: int,
        batch_size: int,
        validation_split: float,
    ) -> dict:
        """Train and return history dict with 'loss' and 'val_loss' keys."""
        ...

    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return predictions as 1-D array."""
        ...

    @property
    def model(self):
        return self._model

    @property
    def training_history(self) -> Optional[dict]:
        return self._history

    def summary(self) -> str:
        if self._model is None:
            return f"{self.name}: not built"
        from io import StringIO
        buf = StringIO()
        self._model.summary(print_fn=lambda x: buf.write(x + "\n"))
        return buf.getvalue()
