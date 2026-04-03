"""
Evaluation service — trains ALL model variants and compares them head-to-head.
Why: This is the core "which algorithm works best" answer; produces the ComparisonReport.
"""

from typing import List, Tuple
import time

import numpy as np

from models import BaseModel
from models import EnsembleModel
from models import ModelFactory
from domain import ModelResult, ComparisonReport
from services import PredictionService
from utils import LoggerFactory
from utils import compute_metrics

log = LoggerFactory.get("services.evaluation")


class EvaluationService:
    """Trains all models, evaluates each, ranks them, builds ensemble."""

    def __init__(self):
        self.prediction_svc = PredictionService()

    def compare_all_models(
        self,
        symbol: str,
        period: str = "2y",
        model_names: List[str] = None,
    ) -> ComparisonReport:
        """
        Train every registered model on the same data, evaluate, rank by RMSE,
        then build an ensemble of the top models.
        """
        if model_names is None:
            model_names = ModelFactory.list_models()

        log.info(f"{'='*60}")
        log.info(f"COMPARING {len(model_names)} MODELS on {symbol} ({period})")
        log.info(f"{'='*60}")

        # Prepare data once — shared across all models
        X_train, X_test, y_train, y_test = self.prediction_svc.prepare_data(
            symbol, period
        )
        input_shape = (X_train.shape[1], X_train.shape[2])

        results: List[ModelResult] = []
        trained_models: List[Tuple[BaseModel, float]] = []

        for name in model_names:
            log.info(f"\n--- Training {name.upper()} ---")
            t0 = time.time()

            try:
                model = ModelFactory.create(name)
                model.build(input_shape)
                history = model.train(
                    X_train, y_train,
                    epochs=50,
                    batch_size=32,
                    validation_split=0.1,
                )

                scaled_preds = model.predict(X_test)
                preds = self.prediction_svc.preprocessor.inverse_transform_target(scaled_preds)
                actual = self.prediction_svc.preprocessor.inverse_transform_target(y_test)

                metrics = compute_metrics(actual, preds)
                elapsed = time.time() - t0

                result = ModelResult(
                    model_name=model.name,
                    mae=metrics.mae,
                    mse=metrics.mse,
                    rmse=metrics.rmse,
                    mape=metrics.mape,
                    r2=metrics.r2,
                    directional_accuracy=metrics.directional_accuracy,
                    training_loss=history.get("loss", []),
                    validation_loss=history.get("val_loss", []),
                    predictions=preds.tolist(),
                    actual_values=actual.tolist(),
                )
                results.append(result)
                trained_models.append((model, metrics.rmse))

                log.info(
                    f"{model.name}: RMSE={metrics.rmse:.4f}, R²={metrics.r2:.4f}, "
                    f"DirAcc={metrics.directional_accuracy:.1f}%, time={elapsed:.1f}s"
                )

            except Exception as e:
                log.error(f"Model {name} failed: {e}")
                continue

        if not results:
            raise RuntimeError("All models failed to train")

        # Rank by RMSE, pick best
        ranked = sorted(results, key=lambda r: r.rmse)
        best_model_name = ranked[0].model_name

        # Build ensemble from top models (use all that succeeded)
        log.info(f"\n--- Building ENSEMBLE ---")
        ensemble = EnsembleModel.from_ranked(trained_models)
        ens_preds = ensemble.predict(X_test)
        ens_preds_inv = self.prediction_svc.preprocessor.inverse_transform_target(ens_preds)
        actual = self.prediction_svc.preprocessor.inverse_transform_target(y_test)
        ens_metrics = compute_metrics(actual, ens_preds_inv)

        ensemble_result = ModelResult(
            model_name="Ensemble",
            mae=ens_metrics.mae,
            mse=ens_metrics.mse,
            rmse=ens_metrics.rmse,
            mape=ens_metrics.mape,
            r2=ens_metrics.r2,
            directional_accuracy=ens_metrics.directional_accuracy,
            predictions=ens_preds_inv.tolist(),
            actual_values=actual.tolist(),
        )

        # If ensemble beats the best single model, use it
        if ens_metrics.rmse < ranked[0].rmse:
            best_model_name = "Ensemble"
            log.info(f"Ensemble WINS with RMSE={ens_metrics.rmse:.4f}")
        else:
            log.info(
                f"Best single model: {best_model_name} "
                f"(RMSE={ranked[0].rmse:.4f} vs Ensemble {ens_metrics.rmse:.4f})"
            )

        report = ComparisonReport(
            symbol=symbol,
            period=period,
            results=results,
            best_model=best_model_name,
            ensemble_result=ensemble_result,
        )

        log.info(f"\n{'='*60}")
        log.info(f"WINNER: {best_model_name}")
        log.info(f"{'='*60}")

        return report
