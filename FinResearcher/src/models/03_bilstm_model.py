"""
Bidirectional LSTM model.
Why: Processes sequences in both forward and backward directions,
capturing patterns that unidirectional models miss (e.g., reversal signals).
"""

import numpy as np
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Bidirectional, Dense, Dropout
from tensorflow.keras.optimizers import Adam

from models import BaseModel
from utils import LoggerFactory

log = LoggerFactory.get("models.bilstm")


class BiLSTMModel(BaseModel):
    def __init__(self, units: int = 64, dropout: float = 0.2, lr: float = 0.001):
        super().__init__("BiLSTM")
        self._units = units
        self._dropout = dropout
        self._lr = lr

    def build(self, input_shape: tuple) -> None:
        self._model = Sequential([
            Bidirectional(
                LSTM(self._units, return_sequences=True),
                input_shape=input_shape,
            ),
            Dropout(self._dropout),
            Bidirectional(LSTM(self._units, return_sequences=False)),
            Dropout(self._dropout),
            Dense(32, activation="relu"),
            Dense(1),
        ])
        self._model.compile(optimizer=Adam(learning_rate=self._lr), loss="mse")
        log.info(f"Built BiLSTM: input_shape={input_shape}, units={self._units}")

    def train(self, X_train, y_train, epochs=50, batch_size=32, validation_split=0.1):
        history = self._model.fit(
            X_train, y_train,
            epochs=epochs,
            batch_size=batch_size,
            validation_split=validation_split,
            verbose=0,
        )
        self._history = history.history
        log.info(f"BiLSTM trained — final loss: {self._history['loss'][-1]:.6f}")
        return self._history

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self._model.predict(X, verbose=0).flatten()
