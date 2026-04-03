# FinResearcher — AI-Powered Financial Research & Stock Prediction

A unified finance research platform combining **Dexter** (AI research agent), **Wilson** (chat & artifacts UI), and **LSTM-Kafka** (deep learning stock prediction) into a single production-ready application.

---

## Architecture Overview

```
┌─────────────────────────── FinResearcher ───────────────────────────┐
│                                                                      │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐   │
│  │   Streamlit Dashboard    │    │     FastAPI REST Server      │   │
│  │  (ui/00_app.py)          │    │     (00_main.py)             │   │
│  └──────────┬───────────────┘    └──────────┬───────────────────┘   │
│             │                                │                       │
│  ┌──────────▼────────────────────────────────▼───────────────────┐  │
│  │                    Service Layer                               │  │
│  │  ┌─────────────────┐ ┌──────────────────┐ ┌───────────────┐  │  │
│  │  │ PredictionSvc   │ │ EvaluationSvc    │ │ BacktestSvc   │  │  │
│  │  └─────────────────┘ └──────────────────┘ └───────────────┘  │  │
│  └────────────────────────────┬──────────────────────────────────┘  │
│                               │                                      │
│  ┌────────────────────────────▼──────────────────────────────────┐  │
│  │                    Model Layer (Factory Pattern)               │  │
│  │  ┌──────┐ ┌─────┐ ┌───────┐ ┌────────┐ ┌──────────┐         │  │
│  │  │ LSTM │ │ GRU │ │BiLSTM │ │CNN-LSTM│ │Attention │         │  │
│  │  └──────┘ └─────┘ └───────┘ └────────┘ └──────────┘         │  │
│  │  ┌───────────┐ ┌──────────┐                                   │  │
│  │  │Transformer│ │ Ensemble │                                   │  │
│  │  └───────────┘ └──────────┘                                   │  │
│  └────────────────────────────┬──────────────────────────────────┘  │
│                               │                                      │
│  ┌────────────────────────────▼──────────────────────────────────┐  │
│  │                    Data Layer                                  │  │
│  │  ┌──────────┐ ┌──────────────┐ ┌────────────┐ ┌────────────┐│  │
│  │  │ Fetcher  │ │ Preprocessor │ │FeatureEng  │ │   Kafka    ││  │
│  │  │(yfinance)│ │  (scaling)   │ │(indicators)│ │ (optional) ││  │
│  │  └──────────┘ └──────────────┘ └────────────┘ └────────────┘│  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Setup
bash scripts/setup.sh

# 2. Activate
source .venv/bin/activate

# 3. Run the Streamlit dashboard
streamlit run src/ui/00_app.py

# 4. Or run the FastAPI server
cd src && uvicorn 00_main:app --reload
```

## Model Comparison Results (AAPL, 1Y)

| Rank | Model | RMSE | R² | Directional Accuracy | MAPE |
|------|-------|------|----|---------------------|------|
| 🥇 | **GRU** | **5.04** | **0.564** | **57.1%** | **1.65%** |
| 🥈 | LSTM | 6.58 | 0.257 | 42.9% | 1.91% |
| 🥉 | CNN-LSTM | 7.30 | 0.086 | 53.6% | 2.42% |
| 4 | Ensemble | 6.35 | 0.309 | 50.0% | 1.83% |
| 5 | Transformer | 10.68 | -0.957 | 46.4% | 3.11% |
| 6 | Attention-LSTM | 12.37 | -1.625 | 42.9% | 3.62% |
| 7 | BiLSTM | 13.46 | -2.108 | 46.4% | 4.98% |

**Winner: GRU** — Fewest parameters, fastest training, best accuracy.

## Project Structure

```
FinResearcher/
├── .env.example                  # Environment configuration
├── .gitignore
├── Dockerfile
├── requirements.txt
│
├── docs/
│   ├── README.md                 # This file
│   ├── architecture.drawio       # HLD + LLD + UML + Flow diagrams
│
├── scripts/
│   ├── setup.sh                  # Environment setup
│   ├── run.sh                    # Run UI/API/both
│   ├── build.sh                  # Docker build
│
└── src/
    ├── 00_main.py                # FastAPI entry point
    ├── 01_config.py              # Singleton configuration
    │
    ├── data/                     # Data pipeline
    │   ├── 00_fetcher.py         # Stock data fetcher (yfinance)
    │   ├── 01_preprocessor.py    # Scaling, splitting, sequences
    │   ├── 02_feature_engineer.py # Technical indicators (SMA, RSI, MACD, BB)
    │   └── 03_kafka_producer.py  # Optional Kafka streaming
    │
    ├── models/                   # 6 ML model variants
    │   ├── 00_base_model.py      # Abstract base (Strategy pattern)
    │   ├── 01_lstm_model.py      # LSTM
    │   ├── 02_gru_model.py       # GRU ← WINNER
    │   ├── 03_bilstm_model.py    # Bidirectional LSTM
    │   ├── 04_cnn_lstm_model.py  # CNN + LSTM hybrid
    │   ├── 05_attention_model.py # Attention + LSTM
    │   ├── 06_transformer_model.py # Transformer encoder
    │   ├── 07_ensemble_model.py  # Weighted ensemble
    │   └── 08_model_factory.py   # Factory pattern
    │
    ├── services/                 # Business logic
    │   ├── 00_prediction_service.py # Full prediction pipeline
    │   ├── 01_evaluation_service.py # Head-to-head model comparison
    │   └── 02_backtest_service.py   # Trading simulation
    │
    ├── api/                      # REST API
    │   ├── 00_routes.py          # FastAPI endpoints
    │   └── 01_schemas.py         # Pydantic validation
    │
    ├── domain/                   # Domain entities
    │   └── 00_entities.py        # StockData, Prediction, ModelResult
    │
    ├── utils/                    # Utilities
    │   ├── 00_logger.py          # Structured logging
    │   └── 01_metrics.py         # MAE, RMSE, R², MAPE, directional accuracy
    │
    ├── ui/
    │   └── 00_app.py             # Streamlit dashboard (5 tabs)
    │
    └── tests/
        ├── test_data.py          # Data pipeline tests (9 tests)
        ├── test_models.py        # All model tests (10 tests)
        ├── test_services.py      # Service tests (5 tests)
        └── test_api.py           # API endpoint tests
```

## Execution Flow

```
00_main.py        → FastAPI server entry point
  └── api/00_routes.py       → HTTP endpoints (/predict, /compare, /backtest)
        └── services/00_prediction_service.py  → Orchestrates the pipeline
              ├── data/00_fetcher.py           → Fetches stock data (yfinance)
              ├── data/02_feature_engineer.py  → Adds technical indicators
              ├── data/01_preprocessor.py      → Scales, creates sequences
              └── models/08_model_factory.py   → Creates model by name
                    └── models/0X_*.py         → Specific model (build→train→predict)

ui/00_app.py      → Streamlit dashboard entry point
  ├── Tab 1: Stock Overview    → Candlestick chart, technicals, volume
  ├── Tab 2: Model Comparison  → Train all 6 models, rank, ensemble
  ├── Tab 3: Predictions       → Next-day price prediction
  ├── Tab 4: Backtesting       → Trading simulation with equity curve
  └── Tab 5: Research          → Technical signals & fundamental analysis
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check + available models |
| POST | `/api/v1/predict` | Next-day price prediction |
| POST | `/api/v1/compare` | Compare all models head-to-head |
| POST | `/api/v1/backtest` | Run trading backtest |
| GET | `/api/v1/stock/{symbol}` | Stock company info |

## Design Patterns

| Pattern | Usage |
|---------|-------|
| **Factory** | `ModelFactory` creates models by string name |
| **Strategy** | `BaseModel` ABC with interchangeable implementations |
| **Singleton** | `Config` global configuration container |
| **Observer** | Streamlit progress callbacks during training |

## Features From Source Projects

| Feature | Source | Implementation |
|---------|--------|---------------|
| Financial data fetching | Dexter | `data/00_fetcher.py` (yfinance) |
| Technical indicators | Wilson (equity charts) | `data/02_feature_engineer.py` |
| LSTM model | lstmstockkafka | `models/01_lstm_model.py` |
| GRU model | deep_learning-main/10.RNN | `models/02_gru_model.py` |
| Bidirectional LSTM | deep_learning-main/10.RNN | `models/03_bilstm_model.py` |
| CNN+LSTM | deep_learning-main/12.CNN | `models/04_cnn_lstm_model.py` |
| Attention mechanism | deep_learning-main/11.Attention | `models/05_attention_model.py` |
| Transformer | deep_learning-main/11.Attention | `models/06_transformer_model.py` |
| Kafka streaming | stock-market-kafka-project | `data/03_kafka_producer.py` |
| Research analysis | Dexter SOUL.md | `ui/00_app.py` Tab 5 |
| Equity curve charts | Wilson equity-curve-chart | `ui/00_app.py` Tab 4 |
| Multi-model evaluation | Original concept | `services/01_evaluation_service.py` |

## Running Tests

```bash
cd src
python -m pytest tests/ -v
```

## Test Results

```
tests/test_data.py       ✅ 9 passed
tests/test_models.py     ✅ 10 passed (all 6 models + ensemble)
tests/test_services.py   ✅ 5 passed (metrics + backtest)
```
