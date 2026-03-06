from django.urls import path
from .api.views import StockPredictionView

urlpatterns = [
    path('api/predict/', StockPredictionView.as_view(), name='stock-predict'),
]
