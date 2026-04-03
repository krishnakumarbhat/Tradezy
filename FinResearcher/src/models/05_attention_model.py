"""
LSTM with Attention mechanism.
Why: Attention lets the model learn which past time-steps matter most
for predicting the next price — inspired by deep_learning-main/11.Attention.
"""

import numpy as np
import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import (
    Input, LSTM, Dense, Dropout, Multiply, Permute,
    RepeatVector, Lambda, Flatten,
)
from tensorflow.keras.optimizers import Adam

from models import BaseModel
from utils import LoggerFactory

log = LoggerFactory.get("models.attention_lstm")


class AttentionLSTMModel(BaseModel):
    def __init__(self, units: int = 64, dropout: float = 0.2, lr: float = 0.001):
        super().__init__("Attention-LSTM")
        self._units = units
        self._dropout = dropout
        self._lr = lr

    def build(self, input_shape: tuple) -> None:
        inp = Input(shape=input_shape)

        # LSTM encoder — returns full sequence for attention
        lstm_out = LSTM(self._units, return_sequences=True)(inp)
        lstm_out = Dropout(self._dropout)(lstm_out)

        # Attention mechanism (Bahdanau-style, simplified)
        attention_scores = Dense(1, activation="tanh")(lstm_out)       # (batch, steps, 1)
        attention_scores = Flatten()(attention_scores)                   # (batch, steps)
        attention_weights = Dense(input_shape[0], activation="softmax")(attention_scores)  # (batch, steps)

        # Apply attention weights to LSTM outputs
        attention_weights = RepeatVector(self._units)(attention_weights)  # (batch, units, steps)
        attention_weights = Permute([2, 1])(attention_weights)           # (batch, steps, units)
        context = Multiply()([lstm_out, attention_weights])              # weighted
        context = Lambda(lambda x: tf.reduce_sum(x, axis=1))(context)   # (batch, units)

        x = Dropout(self._dropout)(context)
        x = Dense(32, activation="relu")(x)
        output = Dense(1)(x)

        self._model = Model(inputs=inp, outputs=output)
        self._model.compile(optimizer=Adam(learning_rate=self._lr), loss="mse")
        log.info(f"Built Attention-LSTM: input_shape={input_shape}, units={self._units}")

    def train(self, X_train, y_train, epochs=50, batch_size=32, validation_split=0.1):
        history = self._model.fit(
            X_train, y_train,
            epochs=epochs,
            batch_size=batch_size,
            validation_split=validation_split,
            verbose=0,
        )
        self._history = history.history
        log.info(f"Attention-LSTM trained — final loss: {self._history['loss'][-1]:.6f}")
        return self._history

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self._model.predict(X, verbose=0).flatten()
