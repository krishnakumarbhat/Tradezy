"""
Configuration singleton for FinResearcher.
Why: Centralizes all tunables so nothing is hard-coded in model or service code.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class ModelConfig:
    lookback: int = 60
    epochs: int = 50
    batch_size: int = 32
    validation_split: float = 0.1
    lstm_units: int = 64
    gru_units: int = 64
    cnn_filters: int = 64
    cnn_kernel: int = 3
    transformer_heads: int = 4
    transformer_ff_dim: int = 128
    dropout_rate: float = 0.2
    learning_rate: float = 0.001


@dataclass(frozen=True)
class DataConfig:
    default_symbol: str = "AAPL"
    default_period: str = "2y"
    train_split: float = 0.8
    features: tuple = (
        "Close", "Volume", "SMA_5", "SMA_20", "SMA_50",
        "EMA_12", "EMA_26", "RSI_14", "MACD", "MACD_Signal",
        "BB_Upper", "BB_Lower", "Returns", "Volatility_20",
    )
    target: str = "Close"


@dataclass(frozen=True)
class KafkaConfig:
    bootstrap_servers: list = field(default_factory=lambda: ["localhost:9092"])
    stock_topic: str = "stock_predictions"
    enabled: bool = False


@dataclass(frozen=True)
class APIConfig:
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True


class Config:
    """Singleton configuration container."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.model = ModelConfig()
            cls._instance.data = DataConfig()
            cls._instance.kafka = KafkaConfig(
                enabled=os.getenv("KAFKA_ENABLED", "false").lower() == "true"
            )
            cls._instance.api = APIConfig(
                debug=os.getenv("DEBUG", "true").lower() == "true"
            )
            cls._instance.project_root = Path(__file__).resolve().parent.parent
        return cls._instance


config = Config()
