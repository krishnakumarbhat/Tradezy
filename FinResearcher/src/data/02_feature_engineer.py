"""
Feature engineering: technical indicators for stock price prediction.
Why: Adds domain-specific signals (SMA, EMA, RSI, MACD, Bollinger Bands)
that improve model accuracy beyond raw OHLCV data.
"""

import numpy as np
import pandas as pd

from utils import LoggerFactory

log = LoggerFactory.get("data.feature_engineer")


class FeatureEngineer:
    """Computes technical indicators in O(n) per indicator via rolling windows."""

    @staticmethod
    def add_all_features(df: pd.DataFrame) -> pd.DataFrame:
        """Add all technical indicators to the dataframe."""
        df = df.copy()

        # Simple Moving Averages
        for window in (5, 20, 50):
            df[f"SMA_{window}"] = df["Close"].rolling(window=window).mean()

        # Exponential Moving Averages
        df["EMA_12"] = df["Close"].ewm(span=12, adjust=False).mean()
        df["EMA_26"] = df["Close"].ewm(span=26, adjust=False).mean()

        # MACD
        df["MACD"] = df["EMA_12"] - df["EMA_26"]
        df["MACD_Signal"] = df["MACD"].ewm(span=9, adjust=False).mean()

        # RSI (Relative Strength Index)
        df["RSI_14"] = FeatureEngineer._compute_rsi(df["Close"], period=14)

        # Bollinger Bands
        sma_20 = df["SMA_20"]
        std_20 = df["Close"].rolling(window=20).std()
        df["BB_Upper"] = sma_20 + 2 * std_20
        df["BB_Lower"] = sma_20 - 2 * std_20

        # Returns and Volatility
        df["Returns"] = df["Close"].pct_change()
        df["Volatility_20"] = df["Returns"].rolling(window=20).std()

        # Drop rows with NaN from rolling calculations
        initial_len = len(df)
        df.dropna(inplace=True)
        log.info(
            f"Added 14 features, dropped {initial_len - len(df)} NaN rows, "
            f"final shape: {df.shape}"
        )

        # Drop Open/High/Low — we keep Close (target) + Volume + engineered features
        df.drop(columns=["Open", "High", "Low"], inplace=True)

        return df

    @staticmethod
    def _compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
        """Wilder's RSI computation — O(n) via exponential moving average."""
        delta = series.diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)

        avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
