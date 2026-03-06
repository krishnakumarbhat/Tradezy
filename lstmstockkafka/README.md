# Stock Prediction System with Django and Kafka

This project implements a stock prediction system using Django, Kafka, and LSTM neural networks. It follows a clean architecture pattern with distinct layers for better organization and maintainability.

## Architecture

The project follows a clean architecture pattern with the following layers:

1. **Presentation Layer** (API Views)
   - Handles HTTP requests and responses
   - Input validation
   - Data formatting

2. **Business Logic Layer** (Services)
   - Stock prediction logic using LSTM
   - Data processing and model training

3. **Data Access Layer** (Models)
   - Database models for stock data and predictions
   - Data persistence

4. **Infrastructure Layer**
   - Kafka integration for real-time data streaming
   - External service integration (yfinance)

## Prerequisites

- Python 3.8+
- Apache Kafka
- Zookeeper

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Start Zookeeper:
```bash
.\bin\windows\zookeeper-server-start.bat .\config\zookeeper.properties
```

3. Start Kafka:
```bash
.\bin\windows\kafka-server-start.bat .\config\server.properties
```

4. Run Django migrations:
```bash
python manage.py makemigrations
python manage.py migrate
```

5. Start the Django server:
```bash
python manage.py runserver
```

## API Endpoints

### Stock Prediction

- **POST /api/predict/**
  - Train model and get prediction for a stock
  - Request body: `{"symbol": "AAPL"}`

- **GET /api/predict/?symbol=AAPL**
  - Get historical predictions for a stock

## Architecture Benefits

1. **Separation of Concerns**: Each layer has a specific responsibility
2. **Maintainability**: Easy to modify or replace components
3. **Testability**: Components can be tested in isolation
4. **Scalability**: Easy to scale individual components
5. **Flexibility**: Easy to add new features or modify existing ones
