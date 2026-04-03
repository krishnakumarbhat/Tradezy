"""
Pydantic schemas for API request/response validation.
Why: Strict input validation at the system boundary prevents bad data from reaching services.
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class PredictRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=10, pattern=r"^[A-Z0-9.]+$")
    model_name: str = Field(default="lstm")
    period: str = Field(default="2y", pattern=r"^\d+[dmy]$")


class PredictResponse(BaseModel):
    symbol: str
    model_name: str
    predicted_price: float
    prediction_date: str
    confidence: float


class CompareRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=10, pattern=r"^[A-Z0-9.]+$")
    period: str = Field(default="2y", pattern=r"^\d+[dmy]$")
    models: Optional[List[str]] = None


class ModelMetrics(BaseModel):
    model_name: str
    mae: float
    mse: float
    rmse: float
    mape: float
    r2: float
    directional_accuracy: float


class CompareResponse(BaseModel):
    symbol: str
    period: str
    best_model: str
    rankings: List[ModelMetrics]
    ensemble: Optional[ModelMetrics] = None


class BacktestRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=10, pattern=r"^[A-Z0-9.]+$")
    model_name: str = Field(default="lstm")
    period: str = Field(default="2y", pattern=r"^\d+[dmy]$")
    initial_capital: float = Field(default=10000.0, gt=0)


class BacktestResponse(BaseModel):
    initial_capital: float
    final_capital: float
    total_return_pct: float
    buy_hold_return_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float


class StockInfoResponse(BaseModel):
    name: str
    sector: str
    industry: str
    market_cap: int
    currency: str


class HealthResponse(BaseModel):
    status: str
    available_models: List[str]
