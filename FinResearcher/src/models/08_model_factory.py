"""
Model Factory — creates model instances by name.
Why: Decouples model selection from model construction;
callers reference models by string name, never import concrete classes.
"""

from typing import Dict, Type

from models import BaseModel
from models import LSTMModel
from models import GRUModel
from models import BiLSTMModel
from models import CNNLSTMModel
from models import AttentionLSTMModel
from models import TransformerModel
from utils import LoggerFactory

log = LoggerFactory.get("models.factory")

_REGISTRY: Dict[str, Type[BaseModel]] = {
    "lstm": LSTMModel,
    "gru": GRUModel,
    "bilstm": BiLSTMModel,
    "cnn_lstm": CNNLSTMModel,
    "attention_lstm": AttentionLSTMModel,
    "transformer": TransformerModel,
}


class ModelFactory:
    """Factory for creating model instances by registered name."""

    @staticmethod
    def create(name: str, **kwargs) -> BaseModel:
        name_lower = name.lower()
        if name_lower not in _REGISTRY:
            raise ValueError(
                f"Unknown model '{name}'. Available: {list(_REGISTRY.keys())}"
            )
        model = _REGISTRY[name_lower](**kwargs)
        log.info(f"Created model: {model.name}")
        return model

    @staticmethod
    def list_models() -> list:
        return list(_REGISTRY.keys())

    @staticmethod
    def create_all(**kwargs) -> list:
        """Create one instance of every registered model."""
        return [cls(**kwargs) for cls in _REGISTRY.values()]
