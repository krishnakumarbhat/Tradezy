import importlib as _il

# Import order matters: base first, then consumers.
# Set attributes immediately so dependent modules can find them.

_base = _il.import_module("models.00_base_model")
BaseModel = _base.BaseModel

_lstm = _il.import_module("models.01_lstm_model")
LSTMModel = _lstm.LSTMModel

_gru = _il.import_module("models.02_gru_model")
GRUModel = _gru.GRUModel

_bilstm = _il.import_module("models.03_bilstm_model")
BiLSTMModel = _bilstm.BiLSTMModel

_cnn_lstm = _il.import_module("models.04_cnn_lstm_model")
CNNLSTMModel = _cnn_lstm.CNNLSTMModel

_attention = _il.import_module("models.05_attention_model")
AttentionLSTMModel = _attention.AttentionLSTMModel

_transformer = _il.import_module("models.06_transformer_model")
TransformerModel = _transformer.TransformerModel

_ensemble = _il.import_module("models.07_ensemble_model")
EnsembleModel = _ensemble.EnsembleModel

_factory = _il.import_module("models.08_model_factory")
ModelFactory = _factory.ModelFactory

__all__ = [
    "BaseModel", "LSTMModel", "GRUModel", "BiLSTMModel",
    "CNNLSTMModel", "AttentionLSTMModel", "TransformerModel",
    "EnsembleModel", "ModelFactory",
]
