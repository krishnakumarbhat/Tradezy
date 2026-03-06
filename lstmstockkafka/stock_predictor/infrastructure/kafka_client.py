from kafka import KafkaProducer, KafkaConsumer
import json
from django.conf import settings
from typing import Dict, Any

class KafkaClient:
    def __init__(self):
        self.producer = KafkaProducer(
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        
        self.consumer = KafkaConsumer(
            settings.KAFKA_STOCK_TOPIC,
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS,
            value_deserializer=lambda x: json.loads(x.decode('utf-8'))
        )
    
    def send_stock_data(self, data: Dict[str, Any]) -> None:
        """Send stock data to Kafka topic"""
        self.producer.send(settings.KAFKA_STOCK_TOPIC, value=data)
        self.producer.flush()
    
    def consume_stock_data(self):
        """Generator to consume stock data from Kafka topic"""
        for message in self.consumer:
            yield message.value
