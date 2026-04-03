"""
CNN-LSTM hybrid model.
Why: Conv1D extracts local patterns (short-term price formations) which
the LSTM then interprets in temporal context — combines spatial & temporal learning.
Inspired by deep_learning-main ConvLSTM architecture.
"""

import numpy as np
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Conv1D, MaxPooling1D, LSTM, Dense, Dropout
from tensorflow.keras.optimizers import Adam

from models import BaseModel
from utils import LoggerFactory

log = LoggerFactory.get("models.cnn_lstm")


class CNNLSTMModel(BaseModel):
    def __init__(
        self,
        filters: int = 64,
        kernel_size: int = 3,
        lstm_units: int = 64,
        dropout: float = 0.2,
        lr: float = 0.001,
    ):
        super().__init__("CNN-LSTM")
        self._filters = filters
        self._kernel = kernel_size
        self._lstm_units = lstm_units
        self._dropout = dropout
        self._lr = lr

    def build(self, input_shape: tuple) -> None:
        self._model = Sequential([
            Conv1D(self._filters, self._kernel, activation="relu", input_shape=input_shape),
            MaxPooling1D(pool_size=2),
            Dropout(self._dropout),
            LSTM(self._lstm_units, return_sequences=False),
            Dropout(self._dropout),
            Dense(32, activation="relu"),
            Dense(1),
        ])
        self._model.compile(optimizer=Adam(learning_rate=self._lr), loss="mse")
        log.info(f"Built CNN-LSTM: filters={self._filters}, lstm_units={self._lstm_units}")

    def train(self, X_train, y_train, epochs=50, batch_size=32, validation_split=0.1):
        history = self._model.fit(
            X_train, y_train,
            epochs=epochs,
            batch_size=batch_size,
            validation_split=validation_split,
            verbose=0,
        )
        self._history = history.history
        log.info(f"CNN-LSTM trained — final loss: {self._history['loss'][-1]:.6f}")
        return self._history

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self._model.predict(X, verbose=0).flatten()
