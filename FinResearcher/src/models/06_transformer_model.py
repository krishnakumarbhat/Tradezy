"""
Transformer encoder model for time-series prediction.
Why: Multi-head self-attention captures complex temporal dependencies
without recurrence; inspired by deep_learning-main/11.Attention transformers.
"""

import numpy as np
import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import (
    Input, Dense, Dropout, LayerNormalization, GlobalAveragePooling1D,
)
from tensorflow.keras.optimizers import Adam

from models import BaseModel
from utils import LoggerFactory

log = LoggerFactory.get("models.transformer")


class TransformerBlock(tf.keras.layers.Layer):
    """Single transformer encoder block with multi-head attention + FFN."""

    def __init__(self, embed_dim: int, num_heads: int, ff_dim: int, dropout: float = 0.1):
        super().__init__()
        self.att = tf.keras.layers.MultiHeadAttention(
            num_heads=num_heads, key_dim=embed_dim
        )
        self.ffn = tf.keras.Sequential([
            Dense(ff_dim, activation="relu"),
            Dense(embed_dim),
        ])
        self.norm1 = LayerNormalization(epsilon=1e-6)
        self.norm2 = LayerNormalization(epsilon=1e-6)
        self.drop1 = Dropout(dropout)
        self.drop2 = Dropout(dropout)

    def call(self, inputs, training=False):
        attn_out = self.att(inputs, inputs)
        attn_out = self.drop1(attn_out, training=training)
        out1 = self.norm1(inputs + attn_out)

        ffn_out = self.ffn(out1)
        ffn_out = self.drop2(ffn_out, training=training)
        return self.norm2(out1 + ffn_out)


class PositionalEncoding(tf.keras.layers.Layer):
    """Sinusoidal positional encoding for sequence position awareness."""

    def __init__(self, max_len: int, d_model: int):
        super().__init__()
        positions = np.arange(max_len)[:, np.newaxis]
        dims = np.arange(d_model)[np.newaxis, :]
        angles = positions / np.power(10000, (2 * (dims // 2)) / d_model)
        angles[:, 0::2] = np.sin(angles[:, 0::2])
        angles[:, 1::2] = np.cos(angles[:, 1::2])
        self.pos_enc = tf.constant(angles[np.newaxis, :, :], dtype=tf.float32)

    def call(self, x):
        return x + self.pos_enc[:, : tf.shape(x)[1], : tf.shape(x)[2]]


class TransformerModel(BaseModel):
    def __init__(
        self,
        num_heads: int = 4,
        ff_dim: int = 128,
        dropout: float = 0.2,
        lr: float = 0.001,
    ):
        super().__init__("Transformer")
        self._num_heads = num_heads
        self._ff_dim = ff_dim
        self._dropout = dropout
        self._lr = lr

    def build(self, input_shape: tuple) -> None:
        seq_len, n_features = input_shape
        inp = Input(shape=input_shape)

        # Project features to embedding dimension (must be divisible by num_heads)
        embed_dim = max(n_features, self._num_heads * 4)
        x = Dense(embed_dim)(inp)
        x = PositionalEncoding(seq_len, embed_dim)(x)

        # Stack two transformer encoder blocks
        x = TransformerBlock(embed_dim, self._num_heads, self._ff_dim, self._dropout)(x)
        x = TransformerBlock(embed_dim, self._num_heads, self._ff_dim, self._dropout)(x)

        x = GlobalAveragePooling1D()(x)
        x = Dropout(self._dropout)(x)
        x = Dense(32, activation="relu")(x)
        output = Dense(1)(x)

        self._model = Model(inputs=inp, outputs=output)
        self._model.compile(optimizer=Adam(learning_rate=self._lr), loss="mse")
        log.info(f"Built Transformer: embed_dim={embed_dim}, heads={self._num_heads}")

    def train(self, X_train, y_train, epochs=50, batch_size=32, validation_split=0.1):
        history = self._model.fit(
            X_train, y_train,
            epochs=epochs,
            batch_size=batch_size,
            validation_split=validation_split,
            verbose=0,
        )
        self._history = history.history
        log.info(f"Transformer trained — final loss: {self._history['loss'][-1]:.6f}")
        return self._history

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self._model.predict(X, verbose=0).flatten()
