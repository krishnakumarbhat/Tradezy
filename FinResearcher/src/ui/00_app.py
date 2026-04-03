"""
Streamlit dashboard — the FinResearcher UI.
Why: Rich, interactive financial research dashboard combining all features:
model comparison, predictions, backtesting, and stock analysis.

Run: streamlit run src/ui/00_app.py
"""

import sys
from pathlib import Path

# Ensure src/ is on the Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import time

from data import DataFetcher
from data import FeatureEngineer
from services import PredictionService
from services import EvaluationService
from services import BacktestService
from models import ModelFactory
from utils import LoggerFactory

log = LoggerFactory.get("ui.app")

# ── Page Config ──────────────────────────────────────────────────────────
st.set_page_config(
    page_title="FinResearcher",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Custom CSS ───────────────────────────────────────────────────────────
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: 700;
        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.5rem;
    }
    .metric-card {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 12px;
        padding: 1.2rem;
        border: 1px solid #333;
    }
    .winner-badge {
        background: linear-gradient(90deg, #00b09b, #96c93d);
        color: white;
        padding: 0.3rem 0.8rem;
        border-radius: 20px;
        font-weight: 600;
    }
    .stTabs [data-baseweb="tab-list"] { gap: 8px; }
    .stTabs [data-baseweb="tab"] {
        border-radius: 8px 8px 0 0;
        padding: 10px 20px;
    }
</style>
""", unsafe_allow_html=True)


# ── Sidebar ──────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown('<p class="main-header">FinResearcher</p>', unsafe_allow_html=True)
    st.caption("AI-Powered Financial Research & Stock Prediction")
    st.divider()

    symbol = st.text_input("Stock Symbol", value="AAPL", max_chars=10).upper()
    period = st.selectbox("Data Period", ["6mo", "1y", "2y", "5y"], index=2)

    st.divider()
    st.subheader("Model Selection")
    all_models = ModelFactory.list_models()
    selected_models = st.multiselect(
        "Models to compare",
        options=all_models,
        default=all_models,
    )

    st.divider()
    st.subheader("Training Config")
    epochs = st.slider("Epochs", 10, 100, 50, step=10)
    lookback = st.slider("Lookback Window", 20, 120, 60, step=10)
    batch_size = st.selectbox("Batch Size", [16, 32, 64], index=1)

    st.divider()
    st.subheader("Backtest Config")
    initial_capital = st.number_input("Initial Capital ($)", value=10000, step=1000)


# ── Tabs ─────────────────────────────────────────────────────────────────
tab_overview, tab_compare, tab_predict, tab_backtest, tab_research = st.tabs([
    "📊 Overview", "🏆 Model Comparison", "🔮 Predictions",
    "📈 Backtesting", "🔍 Research",
])


# ═══════════════════════════════════════════════════════════════════════
# TAB 1: Stock Overview
# ═══════════════════════════════════════════════════════════════════════
with tab_overview:
    st.header(f"{symbol} — Stock Overview")

    try:
        info = DataFetcher.get_info(symbol)
        raw_df = DataFetcher.fetch(symbol, period)
        featured_df = FeatureEngineer.add_all_features(raw_df.copy())

        # Company Info
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Company", info["name"])
        col2.metric("Sector", info["sector"])
        col3.metric("Market Cap", f"${info['market_cap']:,.0f}")
        col4.metric("Latest Close", f"${raw_df['Close'].iloc[-1]:.2f}")

        # Price chart with candlestick
        fig_price = go.Figure()
        fig_price.add_trace(go.Candlestick(
            x=raw_df.index,
            open=raw_df["Open"],
            high=raw_df["High"],
            low=raw_df["Low"],
            close=raw_df["Close"],
            name="OHLC",
        ))
        fig_price.update_layout(
            title=f"{symbol} Price History",
            yaxis_title="Price ($)",
            xaxis_rangeslider_visible=False,
            template="plotly_dark",
            height=500,
        )
        st.plotly_chart(fig_price, use_container_width=True)

        # Technical Indicators
        st.subheader("Technical Indicators")
        col_a, col_b = st.columns(2)

        with col_a:
            fig_sma = go.Figure()
            fig_sma.add_trace(go.Scatter(
                x=featured_df.index, y=featured_df["Close"], name="Close", line=dict(width=1)
            ))
            for sma in ["SMA_5", "SMA_20", "SMA_50"]:
                if sma in featured_df.columns:
                    fig_sma.add_trace(go.Scatter(
                        x=featured_df.index, y=featured_df[sma], name=sma, line=dict(width=1)
                    ))
            fig_sma.update_layout(title="Moving Averages", template="plotly_dark", height=350)
            st.plotly_chart(fig_sma, use_container_width=True)

        with col_b:
            fig_rsi = go.Figure()
            fig_rsi.add_trace(go.Scatter(
                x=featured_df.index, y=featured_df["RSI_14"], name="RSI(14)",
                line=dict(color="#ff6b6b"),
            ))
            fig_rsi.add_hline(y=70, line_dash="dash", line_color="red", annotation_text="Overbought")
            fig_rsi.add_hline(y=30, line_dash="dash", line_color="green", annotation_text="Oversold")
            fig_rsi.update_layout(title="RSI (14)", template="plotly_dark", height=350)
            st.plotly_chart(fig_rsi, use_container_width=True)

        # MACD
        fig_macd = go.Figure()
        fig_macd.add_trace(go.Scatter(
            x=featured_df.index, y=featured_df["MACD"], name="MACD", line=dict(color="#4ecdc4")
        ))
        fig_macd.add_trace(go.Scatter(
            x=featured_df.index, y=featured_df["MACD_Signal"], name="Signal",
            line=dict(color="#ff6b6b"),
        ))
        macd_hist = featured_df["MACD"] - featured_df["MACD_Signal"]
        colors = ["green" if v >= 0 else "red" for v in macd_hist]
        fig_macd.add_trace(go.Bar(
            x=featured_df.index, y=macd_hist, name="Histogram",
            marker_color=colors, opacity=0.5,
        ))
        fig_macd.update_layout(title="MACD", template="plotly_dark", height=350)
        st.plotly_chart(fig_macd, use_container_width=True)

        # Volume
        fig_vol = go.Figure()
        fig_vol.add_trace(go.Bar(
            x=raw_df.index, y=raw_df["Volume"], name="Volume",
            marker_color="rgba(100, 149, 237, 0.5)",
        ))
        fig_vol.update_layout(title="Trading Volume", template="plotly_dark", height=250)
        st.plotly_chart(fig_vol, use_container_width=True)

    except Exception as e:
        st.error(f"Error loading data for {symbol}: {e}")


# ═══════════════════════════════════════════════════════════════════════
# TAB 2: Model Comparison
# ═══════════════════════════════════════════════════════════════════════
with tab_compare:
    st.header("🏆 Model Comparison")
    st.info(
        f"Train and evaluate {len(selected_models)} models on **{symbol}** "
        f"({period} data, {epochs} epochs, lookback={lookback})"
    )

    if st.button("🚀 Run Comparison", type="primary", use_container_width=True):
        # Override config for this run
        import importlib; config = importlib.import_module("01_config").config
        object.__setattr__(config.model, 'epochs', epochs)
        object.__setattr__(config.model, 'lookback', lookback)
        object.__setattr__(config.model, 'batch_size', batch_size)

        progress_bar = st.progress(0)
        status_text = st.empty()

        eval_svc = EvaluationService()
        svc = eval_svc.prediction_svc

        # Prepare data
        status_text.text("📥 Fetching & preparing data...")
        X_train, X_test, y_train, y_test = svc.prepare_data(symbol, period)
        input_shape = (X_train.shape[1], X_train.shape[2])
        progress_bar.progress(10)

        results = []
        trained_data = {}  # model_name -> (preds, actual)

        for idx, model_name in enumerate(selected_models):
            pct = 10 + int(80 * (idx / len(selected_models)))
            status_text.text(f"🧠 Training {model_name.upper()}...")
            progress_bar.progress(pct)

            try:
                model = ModelFactory.create(model_name)
                model.build(input_shape)
                history = model.train(X_train, y_train, epochs, batch_size, 0.1)
                scaled_preds = model.predict(X_test)
                preds = svc.preprocessor.inverse_transform_target(scaled_preds)
                actual = svc.preprocessor.inverse_transform_target(y_test)

                from utils import compute_metrics
                metrics = compute_metrics(actual, preds)

                results.append({
                    "Model": model.name,
                    "MAE": metrics.mae,
                    "RMSE": metrics.rmse,
                    "MAPE (%)": metrics.mape,
                    "R²": metrics.r2,
                    "Dir. Accuracy (%)": metrics.directional_accuracy,
                    "training_loss": history.get("loss", []),
                    "val_loss": history.get("val_loss", []),
                })
                trained_data[model.name] = (preds, actual)

            except Exception as e:
                st.warning(f"❌ {model_name} failed: {e}")

        progress_bar.progress(95)
        status_text.text("📊 Building ensemble & finalizing...")

        # Ensemble
        if len(trained_data) > 1:
            from models import EnsembleModel
            models_rmse = []
            for r in results:
                models_rmse.append((r["Model"], r["RMSE"]))

            ensemble_preds = np.zeros(len(y_test))
            inv_rmses = [1.0 / rmse for _, rmse in models_rmse]
            total = sum(inv_rmses)
            for (name, rmse), inv in zip(models_rmse, inv_rmses):
                weight = inv / total
                p, _ = trained_data[name]
                ensemble_preds += weight * p

            actual = list(trained_data.values())[0][1]
            ens_metrics = compute_metrics(actual, ensemble_preds)
            results.append({
                "Model": "🏅 Ensemble",
                "MAE": ens_metrics.mae,
                "RMSE": ens_metrics.rmse,
                "MAPE (%)": ens_metrics.mape,
                "R²": ens_metrics.r2,
                "Dir. Accuracy (%)": ens_metrics.directional_accuracy,
                "training_loss": [],
                "val_loss": [],
            })
            trained_data["Ensemble"] = (ensemble_preds, actual)

        progress_bar.progress(100)
        status_text.text("✅ Done!")

        # Store results in session state
        st.session_state["compare_results"] = results
        st.session_state["trained_data"] = trained_data

    # Display results if available
    if "compare_results" in st.session_state:
        results = st.session_state["compare_results"]
        trained_data = st.session_state["trained_data"]

        # Metrics table
        df_results = pd.DataFrame(results).drop(columns=["training_loss", "val_loss"])
        df_results = df_results.sort_values("RMSE")

        st.subheader("📋 Results Ranking (sorted by RMSE)")
        st.dataframe(
            df_results.style.highlight_min(
                subset=["MAE", "RMSE", "MAPE (%)"], color="#2ecc71", axis=0
            ).highlight_max(
                subset=["R²", "Dir. Accuracy (%)"], color="#2ecc71", axis=0
            ).format({
                "MAE": "{:.4f}", "RMSE": "{:.4f}", "MAPE (%)": "{:.2f}",
                "R²": "{:.4f}", "Dir. Accuracy (%)": "{:.1f}",
            }),
            use_container_width=True,
        )

        winner = df_results.iloc[0]["Model"]
        st.success(f"🏆 **Best Model: {winner}** (lowest RMSE: {df_results.iloc[0]['RMSE']:.4f})")

        # Charts
        col_left, col_right = st.columns(2)

        with col_left:
            # RMSE comparison bar chart
            fig_bar = px.bar(
                df_results, x="Model", y="RMSE",
                color="RMSE", color_continuous_scale="RdYlGn_r",
                title="RMSE by Model (lower is better)",
            )
            fig_bar.update_layout(template="plotly_dark", height=400)
            st.plotly_chart(fig_bar, use_container_width=True)

        with col_right:
            # R² comparison
            fig_r2 = px.bar(
                df_results, x="Model", y="R²",
                color="R²", color_continuous_scale="RdYlGn",
                title="R² by Model (higher is better)",
            )
            fig_r2.update_layout(template="plotly_dark", height=400)
            st.plotly_chart(fig_r2, use_container_width=True)

        # Prediction vs Actual overlay
        st.subheader("📈 Predictions vs Actual Prices")
        fig_overlay = go.Figure()
        actual = list(trained_data.values())[0][1]
        fig_overlay.add_trace(go.Scatter(
            y=actual, name="Actual", line=dict(color="white", width=2),
        ))
        colors = px.colors.qualitative.Set2
        for i, (name, (preds, _)) in enumerate(trained_data.items()):
            fig_overlay.add_trace(go.Scatter(
                y=preds, name=name,
                line=dict(color=colors[i % len(colors)], width=1, dash="dot"),
            ))
        fig_overlay.update_layout(
            title=f"{symbol} — All Model Predictions vs Actual",
            yaxis_title="Price ($)",
            xaxis_title="Test Sample Index",
            template="plotly_dark",
            height=500,
        )
        st.plotly_chart(fig_overlay, use_container_width=True)

        # Training loss curves
        st.subheader("📉 Training Loss Curves")
        fig_loss = go.Figure()
        for r in results:
            if r["training_loss"]:
                fig_loss.add_trace(go.Scatter(
                    y=r["training_loss"], name=f"{r['Model']} (train)",
                    line=dict(width=1),
                ))
            if r["val_loss"]:
                fig_loss.add_trace(go.Scatter(
                    y=r["val_loss"], name=f"{r['Model']} (val)",
                    line=dict(width=1, dash="dash"),
                ))
        fig_loss.update_layout(
            title="Loss Convergence",
            yaxis_title="MSE Loss",
            xaxis_title="Epoch",
            template="plotly_dark",
            height=400,
        )
        st.plotly_chart(fig_loss, use_container_width=True)


# ═══════════════════════════════════════════════════════════════════════
# TAB 3: Next-Day Prediction
# ═══════════════════════════════════════════════════════════════════════
with tab_predict:
    st.header("🔮 Next-Day Price Prediction")

    pred_model = st.selectbox("Select Model", ModelFactory.list_models(), key="pred_model")

    if st.button("Predict Next Day", type="primary"):
        with st.spinner(f"Training {pred_model.upper()} and predicting..."):
            try:
                import importlib; config = importlib.import_module("01_config").config
                object.__setattr__(config.model, 'epochs', epochs)
                object.__setattr__(config.model, 'lookback', lookback)

                svc = PredictionService()
                prediction = svc.predict_next_day(symbol, pred_model, period)

                col1, col2, col3 = st.columns(3)
                col1.metric("🗓️ Prediction Date", prediction.prediction_date.strftime("%Y-%m-%d"))
                col2.metric("💰 Predicted Price", f"${prediction.predicted_price:.2f}")
                col3.metric("📊 Confidence", f"{prediction.confidence * 100:.1f}%")

                # Show recent prices for context
                raw_df = DataFetcher.fetch(symbol, "3mo")
                fig = go.Figure()
                fig.add_trace(go.Scatter(
                    x=raw_df.index, y=raw_df["Close"],
                    name="Historical Close", line=dict(color="cyan", width=2),
                ))
                # Add prediction point
                import pandas as pd
                fig.add_trace(go.Scatter(
                    x=[prediction.prediction_date],
                    y=[prediction.predicted_price],
                    mode="markers+text",
                    marker=dict(size=15, color="gold", symbol="star"),
                    text=[f"${prediction.predicted_price:.2f}"],
                    textposition="top center",
                    name="Prediction",
                ))
                fig.update_layout(
                    title=f"{symbol} — Next Day Prediction ({pred_model})",
                    template="plotly_dark",
                    height=450,
                )
                st.plotly_chart(fig, use_container_width=True)

            except Exception as e:
                st.error(f"Prediction failed: {e}")


# ═══════════════════════════════════════════════════════════════════════
# TAB 4: Backtesting
# ═══════════════════════════════════════════════════════════════════════
with tab_backtest:
    st.header("📈 Backtesting")
    st.info("Simulates directional trading: buy when predicted up, sell when predicted down.")

    bt_model = st.selectbox("Select Model", ModelFactory.list_models(), key="bt_model")

    if st.button("Run Backtest", type="primary"):
        with st.spinner(f"Running backtest with {bt_model.upper()}..."):
            try:
                import importlib; config = importlib.import_module("01_config").config
                object.__setattr__(config.model, 'epochs', epochs)
                object.__setattr__(config.model, 'lookback', lookback)

                svc = PredictionService()
                X_train, X_test, y_train, y_test = svc.prepare_data(symbol, period)

                model = ModelFactory.create(bt_model)
                scaled_preds = svc.train_and_predict(model, X_train, X_test, y_train)
                actual = svc.preprocessor.inverse_transform_target(y_test)
                preds = svc.preprocessor.inverse_transform_target(scaled_preds)

                result = BacktestService.run(actual, preds, initial_capital)

                # Metrics display
                st.subheader("Performance Metrics")
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("Final Capital", f"${result.final_capital:,.2f}",
                          delta=f"{result.total_return_pct:+.2f}%")
                c2.metric("Buy & Hold", f"{result.buy_hold_return_pct:+.2f}%")
                c3.metric("Sharpe Ratio", f"{result.sharpe_ratio:.2f}")
                c4.metric("Max Drawdown", f"-{result.max_drawdown_pct:.1f}%")

                c5, c6, c7, c8 = st.columns(4)
                c5.metric("Total Trades", result.total_trades)
                c6.metric("Win Rate", f"{result.win_rate:.1f}%")
                c7.metric("Winning", result.winning_trades)
                c8.metric("Losing", result.losing_trades)

                # Equity curve
                fig_eq = go.Figure()
                fig_eq.add_trace(go.Scatter(
                    y=result.equity_curve, name="Strategy Equity",
                    fill="tozeroy",
                    line=dict(color="#4ecdc4", width=2),
                ))
                fig_eq.add_hline(
                    y=initial_capital, line_dash="dash",
                    line_color="gray", annotation_text="Initial Capital",
                )
                fig_eq.update_layout(
                    title=f"{symbol} — Equity Curve ({bt_model})",
                    yaxis_title="Portfolio Value ($)",
                    template="plotly_dark",
                    height=450,
                )
                st.plotly_chart(fig_eq, use_container_width=True)

                # Strategy vs Buy & Hold
                bh_equity = initial_capital * (actual / actual[0])
                fig_vs = go.Figure()
                fig_vs.add_trace(go.Scatter(
                    y=result.equity_curve, name="Strategy", line=dict(color="#4ecdc4"),
                ))
                fig_vs.add_trace(go.Scatter(
                    y=bh_equity, name="Buy & Hold", line=dict(color="#ff6b6b"),
                ))
                fig_vs.update_layout(
                    title="Strategy vs Buy & Hold",
                    yaxis_title="Portfolio Value ($)",
                    template="plotly_dark",
                    height=400,
                )
                st.plotly_chart(fig_vs, use_container_width=True)

            except Exception as e:
                st.error(f"Backtest failed: {e}")


# ═══════════════════════════════════════════════════════════════════════
# TAB 5: Stock Research (Dexter-inspired)
# ═══════════════════════════════════════════════════════════════════════
with tab_research:
    st.header("🔍 Financial Research")
    st.info("Quick fundamental analysis inspired by Dexter's research agent.")

    if st.button("📊 Analyze", type="primary"):
        with st.spinner(f"Researching {symbol}..."):
            try:
                info = DataFetcher.get_info(symbol)
                raw_df = DataFetcher.fetch(symbol, period)
                featured_df = FeatureEngineer.add_all_features(raw_df.copy())

                st.subheader(f"{info['name']} ({symbol})")
                st.write(f"**Sector:** {info['sector']} | **Industry:** {info['industry']}")
                st.write(f"**Market Cap:** ${info['market_cap']:,.0f}")

                # Key Statistics
                st.subheader("Key Statistics")
                latest = raw_df.iloc[-1]
                prev_close = raw_df["Close"].iloc[-2]
                change = latest["Close"] - prev_close
                change_pct = (change / prev_close) * 100

                c1, c2, c3, c4 = st.columns(4)
                c1.metric("Current Price", f"${latest['Close']:.2f}", f"{change_pct:+.2f}%")
                c2.metric("52-Week High", f"${raw_df['High'].max():.2f}")
                c3.metric("52-Week Low", f"${raw_df['Low'].min():.2f}")
                c4.metric("Avg Volume", f"{raw_df['Volume'].mean():,.0f}")

                # Technical Signals
                st.subheader("Technical Signals")
                latest_feat = featured_df.iloc[-1]

                signals = []
                # RSI Signal
                rsi = latest_feat["RSI_14"]
                if rsi > 70:
                    signals.append(("RSI", f"{rsi:.1f}", "🔴 Overbought", "Bearish"))
                elif rsi < 30:
                    signals.append(("RSI", f"{rsi:.1f}", "🟢 Oversold", "Bullish"))
                else:
                    signals.append(("RSI", f"{rsi:.1f}", "🟡 Neutral", "Neutral"))

                # MACD Signal
                macd = latest_feat["MACD"]
                macd_sig = latest_feat["MACD_Signal"]
                if macd > macd_sig:
                    signals.append(("MACD", f"{macd:.4f}", "🟢 Above Signal", "Bullish"))
                else:
                    signals.append(("MACD", f"{macd:.4f}", "🔴 Below Signal", "Bearish"))

                # SMA Signal
                close = latest_feat["Close"]
                sma_50 = latest_feat["SMA_50"]
                if close > sma_50:
                    signals.append(("SMA 50", f"${sma_50:.2f}", "🟢 Above", "Bullish"))
                else:
                    signals.append(("SMA 50", f"${sma_50:.2f}", "🔴 Below", "Bearish"))

                # Bollinger Bands
                bb_upper = latest_feat["BB_Upper"]
                bb_lower = latest_feat["BB_Lower"]
                if close > bb_upper:
                    signals.append(("Bollinger", f"${bb_upper:.2f}", "🔴 Above Upper", "Bearish"))
                elif close < bb_lower:
                    signals.append(("Bollinger", f"${bb_lower:.2f}", "🟢 Below Lower", "Bullish"))
                else:
                    signals.append(("Bollinger", "Within Bands", "🟡 Neutral", "Neutral"))

                sig_df = pd.DataFrame(signals, columns=["Indicator", "Value", "Status", "Signal"])
                st.dataframe(sig_df, use_container_width=True, hide_index=True)

                # Volatility Analysis
                st.subheader("Volatility Analysis")
                vol = featured_df["Volatility_20"]
                fig_vol = go.Figure()
                fig_vol.add_trace(go.Scatter(
                    x=featured_df.index, y=vol, name="20-Day Volatility",
                    fill="tozeroy", line=dict(color="#ff6b6b"),
                ))
                fig_vol.update_layout(
                    title="Historical Volatility (20-Day)",
                    template="plotly_dark", height=300,
                )
                st.plotly_chart(fig_vol, use_container_width=True)

                # Returns Distribution
                st.subheader("Returns Distribution")
                returns = featured_df["Returns"]
                fig_dist = go.Figure()
                fig_dist.add_trace(go.Histogram(
                    x=returns, nbinsx=50, name="Daily Returns",
                    marker_color="rgba(100, 149, 237, 0.6)",
                ))
                fig_dist.update_layout(
                    title="Daily Returns Distribution",
                    xaxis_title="Return (%)",
                    template="plotly_dark", height=300,
                )
                st.plotly_chart(fig_dist, use_container_width=True)

                # Correlation Matrix
                st.subheader("Feature Correlation")
                corr_cols = ["Close", "Volume", "RSI_14", "MACD", "SMA_20", "Volatility_20"]
                corr = featured_df[corr_cols].corr()
                fig_corr = px.imshow(
                    corr, text_auto=".2f",
                    color_continuous_scale="RdBu_r",
                    title="Feature Correlation Matrix",
                )
                fig_corr.update_layout(template="plotly_dark", height=400)
                st.plotly_chart(fig_corr, use_container_width=True)

            except Exception as e:
                st.error(f"Research failed: {e}")


# ── Footer ───────────────────────────────────────────────────────────────
st.divider()
st.caption(
    "FinResearcher v1.0 — Combining Dexter (AI Research Agent), "
    "Wilson (Chat & Artifacts), and LSTM-Kafka (Deep Learning Predictions)"
)
