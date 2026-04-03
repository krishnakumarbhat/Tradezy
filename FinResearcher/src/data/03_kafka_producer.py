"""
Kafka producer for streaming predictions.
Why: Decouples prediction generation from downstream consumers (dashboards, alerts).
Optional — only used when KAFKA_ENABLED=true.
"""

import json
from typing import Optional

from utils import LoggerFactory

log = LoggerFactory.get("data.kafka_producer")


class KafkaProducer:
    """Publishes stock predictions to a Kafka topic."""

    def __init__(self, bootstrap_servers: list, topic: str):
        self._topic = topic
        self._producer: Optional[object] = None
        try:
            from kafka import KafkaProducer as _KP

            self._producer = _KP(
                bootstrap_servers=bootstrap_servers,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            )
            log.info(f"Kafka producer connected to {bootstrap_servers}")
        except ImportError:
            log.warning("kafka-python not installed — Kafka disabled")
        except Exception as e:
            log.warning(f"Kafka connection failed: {e}")

    def send_prediction(self, prediction: dict) -> bool:
        if self._producer is None:
            return False
        try:
            self._producer.send(self._topic, value=prediction)
            self._producer.flush()
            log.info(f"Sent prediction to Kafka topic '{self._topic}'")
            return True
        except Exception as e:
            log.error(f"Kafka send failed: {e}")
            return False
