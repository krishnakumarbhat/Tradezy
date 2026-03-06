from django.db import models

class StockData(models.Model):
    symbol = models.CharField(max_length=10)
    date = models.DateTimeField()
    open_price = models.FloatField()
    high_price = models.FloatField()
    low_price = models.FloatField()
    close_price = models.FloatField()
    volume = models.IntegerField()
    
    class Meta:
        ordering = ['-date']
        
class StockPrediction(models.Model):
    symbol = models.CharField(max_length=10)
    prediction_date = models.DateTimeField()
    predicted_price = models.FloatField()
    confidence = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-prediction_date']
