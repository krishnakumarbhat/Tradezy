import numpy as np
import pandas as pd
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from sklearn.preprocessing import MinMaxScaler
from typing import List, Tuple
import yfinance as yf

class StockPredictionService:
    def __init__(self):
        self.model = None
        self.scaler = MinMaxScaler()
        
    def prepare_data(self, data: pd.DataFrame, lookback: int = 60) -> Tuple[np.ndarray, np.ndarray]:
        """Prepare data for LSTM model"""
        scaled_data = self.scaler.fit_transform(data[['Close']].values)
        X, y = [], []
        
        for i in range(lookback, len(scaled_data)):
            X.append(scaled_data[i-lookback:i])
            y.append(scaled_data[i])
            
        return np.array(X), np.array(y)
    
    def build_model(self, lookback: int) -> None:
        """Build LSTM model"""
        self.model = Sequential([
            LSTM(50, return_sequences=True, input_shape=(lookback, 1)),
            Dropout(0.2),
            LSTM(50, return_sequences=False),
            Dropout(0.2),
            Dense(1)
        ])
        self.model.compile(optimizer='adam', loss='mean_squared_error')
    
    def train_model(self, symbol: str, period: str = '2y') -> None:
        """Train the LSTM model with historical data"""
        # Fetch historical data
        stock = yf.Ticker(symbol)
        data = stock.history(period=period)
        
        # Prepare data
        X, y = self.prepare_data(data)
        
        # Build and train model
        self.build_model(lookback=60)
        self.model.fit(X, y, epochs=50, batch_size=32, validation_split=0.1)
    
    def predict_next_day(self, symbol: str) -> float:
        """Predict next day's closing price"""
        # Get recent data
        stock = yf.Ticker(symbol)
        data = stock.history(period='70d')  # Get enough data for lookback
        
        # Prepare prediction data
        scaled_data = self.scaler.transform(data[['Close']].values)
        X_pred = scaled_data[-60:].reshape(1, 60, 1)
        
        # Make prediction
        prediction = self.model.predict(X_pred)
        return float(self.scaler.inverse_transform(prediction)[0][0])
