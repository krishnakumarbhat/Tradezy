"""
FastAPI routes — thin controller layer mapping HTTP endpoints to services.
Why: Controllers only validate input (via Pydantic) and delegate to services.
"""

from fastapi import APIRouter, HTTPException
import numpy as np
import importlib as _il

_schemas = _il.import_module("api.01_schemas")
PredictRequest = _schemas.PredictRequest
PredictResponse = _schemas.PredictResponse
CompareRequest = _schemas.CompareRequest
CompareResponse = _schemas.CompareResponse
ModelMetrics = _schemas.ModelMetrics
BacktestRequest = _schemas.BacktestRequest
BacktestResponse = _schemas.BacktestResponse
StockInfoResponse = _schemas.StockInfoResponse
HealthResponse = _schemas.HealthResponse

from services import PredictionService
from services import EvaluationService
from services import BacktestService
from models import ModelFactory
from data import DataFetcher
from utils import LoggerFactory

log = LoggerFactory.get("api.routes")
router = APIRouter(prefix="/api/v1")

prediction_svc = PredictionService()
evaluation_svc = EvaluationService()
backtest_svc = BacktestService()


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        available_models=ModelFactory.list_models(),
    )


@router.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    try:
        pred = prediction_svc.predict_next_day(
            symbol=req.symbol,
            model_name=req.model_name,
            period=req.period,
        )
        return PredictResponse(
            symbol=pred.symbol,
            model_name=pred.model_name,
            predicted_price=round(pred.predicted_price, 2),
            prediction_date=pred.prediction_date.isoformat(),
            confidence=round(pred.confidence, 4),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail="Prediction failed")


@router.post("/compare", response_model=CompareResponse)
async def compare(req: CompareRequest):
    try:
        report = evaluation_svc.compare_all_models(
            symbol=req.symbol,
            period=req.period,
            model_names=req.models,
        )
        rankings = [
            ModelMetrics(**r.to_dict())
            for r in report.ranking()
        ]
        ensemble = (
            ModelMetrics(**report.ensemble_result.to_dict())
            if report.ensemble_result else None
        )
        return CompareResponse(
            symbol=report.symbol,
            period=report.period,
            best_model=report.best_model,
            rankings=rankings,
            ensemble=ensemble,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Comparison failed: {e}")
        raise HTTPException(status_code=500, detail="Model comparison failed")


@router.post("/backtest", response_model=BacktestResponse)
async def backtest(req: BacktestRequest):
    try:
        # Train model and get predictions + actuals
        X_train, X_test, y_train, y_test = prediction_svc.prepare_data(
            req.symbol, req.period
        )
        model = ModelFactory.create(req.model_name)
        scaled_preds = prediction_svc.train_and_predict(model, X_train, X_test, y_train)

        actual = prediction_svc.preprocessor.inverse_transform_target(y_test)
        preds = prediction_svc.preprocessor.inverse_transform_target(scaled_preds)

        result = backtest_svc.run(actual, preds, req.initial_capital)
        return BacktestResponse(**result.to_dict())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Backtest failed: {e}")
        raise HTTPException(status_code=500, detail="Backtest failed")


@router.get("/stock/{symbol}", response_model=StockInfoResponse)
async def stock_info(symbol: str):
    try:
        info = DataFetcher.get_info(symbol.upper())
        return StockInfoResponse(**info)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
