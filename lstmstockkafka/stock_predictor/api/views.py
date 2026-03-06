from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from ..services.stock_service import StockPredictionService
from ..infrastructure.kafka_client import KafkaClient
from ..domain.models import StockData, StockPrediction
from datetime import datetime
import yfinance as yf

class StockPredictionView(APIView):
    def __init__(self):
        super().__init__()
        self.prediction_service = StockPredictionService()
        self.kafka_client = KafkaClient()
    
    def post(self, request):
        """Train model and make prediction for a stock"""
        symbol = request.data.get('symbol')
        if not symbol:
            return Response(
                {'error': 'Stock symbol is required'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            # Train model
            self.prediction_service.train_model(symbol)
            
            # Make prediction
            predicted_price = self.prediction_service.predict_next_day(symbol)
            
            # Save prediction
            prediction = StockPrediction.objects.create(
                symbol=symbol,
                prediction_date=datetime.now(),
                predicted_price=predicted_price,
                confidence=0.95  # This should be calculated based on model metrics
            )
            
            # Send to Kafka
            self.kafka_client.send_stock_data({
                'symbol': symbol,
                'predicted_price': predicted_price,
                'timestamp': datetime.now().isoformat()
            })
            
            return Response({
                'symbol': symbol,
                'predicted_price': predicted_price,
                'prediction_date': prediction.prediction_date
            })
            
        except Exception as e:
            return Response(
                {'error': str(e)}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def get(self, request):
        """Get historical predictions for a stock"""
        symbol = request.query_params.get('symbol')
        if not symbol:
            return Response(
                {'error': 'Stock symbol is required'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        predictions = StockPrediction.objects.filter(symbol=symbol).order_by('-prediction_date')[:10]
        
        return Response([{
            'symbol': p.symbol,
            'predicted_price': p.predicted_price,
            'prediction_date': p.prediction_date,
            'confidence': p.confidence
        } for p in predictions])
