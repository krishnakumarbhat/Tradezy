"""
Backtesting service — simulates trading with model predictions.
Why: Validates model accuracy with a realistic trading simulation
(buy when predicted up, sell when predicted down).
"""

from dataclasses import dataclass, field
from typing import List
import numpy as np

from utils import LoggerFactory

log = LoggerFactory.get("services.backtest")


@dataclass
class BacktestResult:
    initial_capital: float
    final_capital: float
    total_return_pct: float
    buy_hold_return_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    equity_curve: List[float] = field(default_factory=list)
    dates: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "initial_capital": self.initial_capital,
            "final_capital": round(self.final_capital, 2),
            "total_return_pct": round(self.total_return_pct, 2),
            "buy_hold_return_pct": round(self.buy_hold_return_pct, 2),
            "sharpe_ratio": round(self.sharpe_ratio, 4),
            "max_drawdown_pct": round(self.max_drawdown_pct, 2),
            "total_trades": self.total_trades,
            "winning_trades": self.winning_trades,
            "losing_trades": self.losing_trades,
            "win_rate": round(self.win_rate, 2),
        }


class BacktestService:
    """Simple directional-trading backtest: long when predicted up, flat when predicted down."""

    @staticmethod
    def run(
        actual_prices: np.ndarray,
        predicted_prices: np.ndarray,
        initial_capital: float = 10_000.0,
    ) -> BacktestResult:
        actual = np.asarray(actual_prices).flatten()
        predicted = np.asarray(predicted_prices).flatten()
        n = min(len(actual), len(predicted))
        actual, predicted = actual[:n], predicted[:n]

        capital = initial_capital
        position = 0.0  # shares held
        equity_curve = [capital]
        trades = 0
        wins = 0
        losses = 0

        for i in range(1, n):
            predicted_direction_up = predicted[i] > predicted[i - 1]
            price_now = actual[i]
            price_prev = actual[i - 1]

            if predicted_direction_up and position == 0:
                # Buy: go long with all capital
                position = capital / price_prev
                capital = 0.0
                trades += 1
            elif not predicted_direction_up and position > 0:
                # Sell: close position
                sell_value = position * price_now
                profit = sell_value - (position * price_prev)
                if profit > 0:
                    wins += 1
                else:
                    losses += 1
                capital = sell_value
                position = 0.0

            # Track equity
            current_value = capital + position * price_now
            equity_curve.append(current_value)

        # Close any remaining position
        if position > 0:
            capital = position * actual[-1]
            position = 0.0

        final = capital
        total_return = ((final - initial_capital) / initial_capital) * 100
        bh_return = ((actual[-1] - actual[0]) / actual[0]) * 100

        # Sharpe ratio (annualized, ~252 trading days)
        eq = np.array(equity_curve)
        daily_returns = np.diff(eq) / eq[:-1]
        sharpe = 0.0
        if len(daily_returns) > 1 and np.std(daily_returns) > 0:
            sharpe = (np.mean(daily_returns) / np.std(daily_returns)) * np.sqrt(252)

        # Max drawdown
        peak = np.maximum.accumulate(eq)
        drawdowns = (peak - eq) / peak * 100
        max_dd = float(np.max(drawdowns))

        win_rate = (wins / trades * 100) if trades > 0 else 0.0

        result = BacktestResult(
            initial_capital=initial_capital,
            final_capital=final,
            total_return_pct=total_return,
            buy_hold_return_pct=bh_return,
            sharpe_ratio=sharpe,
            max_drawdown_pct=max_dd,
            total_trades=trades,
            winning_trades=wins,
            losing_trades=losses,
            win_rate=win_rate,
            equity_curve=equity_curve,
        )

        log.info(
            f"Backtest: return={total_return:.2f}% vs B&H={bh_return:.2f}%, "
            f"Sharpe={sharpe:.2f}, MaxDD={max_dd:.1f}%"
        )
        return result
