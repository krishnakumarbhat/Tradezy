"""
Stock data fetcher using yfinance.
Why: Isolates data acquisition from processing; single responsibility for fetching.
"""

import pandas as pd
import yfinance as yf

from utils import LoggerFactory

log = LoggerFactory.get("data.fetcher")


class DataFetcher:
    """Fetches historical stock data from Yahoo Finance."""

    @staticmethod
    def fetch(symbol: str, period: str = "2y") -> pd.DataFrame:
        """
        Download OHLCV data for a given symbol.
        Returns DataFrame with columns: Open, High, Low, Close, Volume.
        """
        log.info(f"Fetching {symbol} data for period={period}")
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period)

        if df.empty:
            raise ValueError(f"No data returned for symbol '{symbol}'")

        # Keep only needed columns, drop NaN rows
        df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
        log.info(f"Fetched {len(df)} rows for {symbol}")
        return df

    @staticmethod
    def fetch_range(symbol: str, start: str, end: str) -> pd.DataFrame:
        """Fetch data for a specific date range."""
        log.info(f"Fetching {symbol} from {start} to {end}")
        df = yf.download(symbol, start=start, end=end, progress=False)

        if df.empty:
            raise ValueError(f"No data for {symbol} in range {start}–{end}")

        df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
        log.info(f"Fetched {len(df)} rows for {symbol}")
        return df

    @staticmethod
    def get_info(symbol: str) -> dict:
        """Fetch company info: sector, name, market cap."""
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return {
            "name": info.get("shortName", symbol),
            "sector": info.get("sector", "Unknown"),
            "industry": info.get("industry", "Unknown"),
            "market_cap": info.get("marketCap", 0),
            "currency": info.get("currency", "USD"),
        }
