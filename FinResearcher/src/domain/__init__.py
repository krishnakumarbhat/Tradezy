import importlib as _il

_entities = _il.import_module("domain.00_entities")

StockData = _entities.StockData
Prediction = _entities.Prediction
ModelResult = _entities.ModelResult
ComparisonReport = _entities.ComparisonReport

__all__ = ["StockData", "Prediction", "ModelResult", "ComparisonReport"]
