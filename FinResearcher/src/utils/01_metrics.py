"""
Statistical metrics for model evaluation.
Why: Single source of truth for all evaluation metrics used across services.
"""

import numpy as np
from dataclasses import dataclass


@dataclass
class EvaluationMetrics:
    mae: float
    mse: float
    rmse: float
    mape: float
    r2: float
    directional_accuracy: float

    def to_dict(self) -> dict:
        return {
            "mae": round(self.mae, 6),
            "mse": round(self.mse, 6),
            "rmse": round(self.rmse, 6),
            "mape": round(self.mape, 4),
            "r2": round(self.r2, 4),
            "directional_accuracy": round(self.directional_accuracy, 4),
        }


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> EvaluationMetrics:
    """Compute all evaluation metrics in O(n)."""
    y_true = np.asarray(y_true).flatten()
    y_pred = np.asarray(y_pred).flatten()

    diff = y_true - y_pred
    mae = np.mean(np.abs(diff))
    mse = np.mean(diff ** 2)
    rmse = np.sqrt(mse)

    # Avoid division by zero in MAPE
    nonzero_mask = y_true != 0
    if nonzero_mask.any():
        mape = np.mean(np.abs(diff[nonzero_mask] / y_true[nonzero_mask])) * 100
    else:
        mape = float("inf")

    # R-squared
    ss_res = np.sum(diff ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    r2 = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    # Directional accuracy (predicting up/down correctly)
    if len(y_true) > 1:
        true_dir = np.diff(y_true) > 0
        pred_dir = np.diff(y_pred) > 0
        directional_accuracy = np.mean(true_dir == pred_dir) * 100
    else:
        directional_accuracy = 0.0

    return EvaluationMetrics(
        mae=float(mae),
        mse=float(mse),
        rmse=float(rmse),
        mape=float(mape),
        r2=float(r2),
        directional_accuracy=float(directional_accuracy),
    )
