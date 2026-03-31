"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useTheme } from "next-themes";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const DEFAULT_STARTING_BALANCE = 100_000;

export type EquityCurveTrade = {
  entry_date?: string;
  exit_date?: string;
  pnl?: number;
};

export type EquityPoint = {
  time: Time;
  value: number;
};

/**
 * Build equity curve data from trades.
 * - Sorts trades by exit_date.
 * - cumulative_equity = starting_balance + cumulative_sum(pnl).
 * - Uses exit_date as the time index; adds an initial point at first entry_date for a flat start.
 */
export function buildEquityFromTrades(
  trades: EquityCurveTrade[],
  startingBalance: number = DEFAULT_STARTING_BALANCE
): EquityPoint[] {
  if (trades.length === 0) {
    return [];
  }

  const sorted = [...trades].sort((a, b) => {
    const aExit = a.exit_date ?? "";
    const bExit = b.exit_date ?? "";
    return aExit.localeCompare(bExit);
  });

  const points: EquityPoint[] = [];
  const first = sorted[0];
  const firstEntry = first?.entry_date;
  if (firstEntry) {
    points.push({ time: firstEntry as Time, value: startingBalance });
  }

  let cumulative = startingBalance;
  for (const t of sorted) {
    const pnl = t.pnl ?? 0;
    cumulative += pnl;
    const exitDate = t.exit_date;
    if (exitDate) {
      points.push({ time: exitDate as Time, value: cumulative });
    }
  }

  return points;
}

/**
 * Build entry/exit markers for the chart.
 * - Entry: belowBar, arrowUp, at entry_date (use first point's value or series value at that time).
 * - Exit: aboveBar, arrowDown, at exit_date.
 * We use bar-position markers (belowBar/aboveBar) so we don't need exact price.
 */
export function buildMarkersFromTrades(
  trades: EquityCurveTrade[]
): Array<{ time: Time; position: "aboveBar" | "belowBar"; shape: "arrowUp" | "arrowDown"; color: string; text: string }> {
  const sorted = [...trades].sort((a, b) =>
    (a.exit_date ?? "").localeCompare(b.exit_date ?? "")
  );
  const markers: Array<{
    time: Time;
    position: "aboveBar" | "belowBar";
    shape: "arrowUp" | "arrowDown";
    color: string;
    text: string;
  }> = [];

  const entryColor = "#22c55e";
  const exitColor = "#ef4444";

  for (const t of sorted) {
    if (t.entry_date) {
      markers.push({
        time: t.entry_date as Time,
        position: "belowBar",
        shape: "arrowUp",
        color: entryColor,
        text: "Entry",
      });
    }
    if (t.exit_date) {
      markers.push({
        time: t.exit_date as Time,
        position: "aboveBar",
        shape: "arrowDown",
        color: exitColor,
        text: "Exit",
      });
    }
  }

  return markers;
}

type EquityCurveChartProps = {
  trades: EquityCurveTrade[];
  symbol: string;
  startingBalance?: number;
  height?: number;
};

export function EquityCurveChart({
  trades,
  symbol,
  startingBalance = DEFAULT_STARTING_BALANCE,
  height = 320,
}: EquityCurveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const isDark = resolvedTheme === "dark";
  const layout = useMemo(
    () => ({
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: isDark ? "#a1a1aa" : "#52525b",
      fontFamily: "inherit",
      fontSize: 12,
    }),
    [isDark]
  );
  const grid = useMemo(
    () => ({
      vertLines: { color: isDark ? "#27272a" : "#e4e4e7" },
      horzLines: { color: isDark ? "#27272a" : "#e4e4e7" },
    }),
    [isDark]
  );
  const areaTopColor = isDark ? "rgba(34, 197, 94, 0.4)" : "rgba(34, 197, 94, 0.28)";
  const areaBottomColor = isDark ? "rgba(34, 197, 94, 0.05)" : "rgba(34, 197, 94, 0.05)";
  const lineColor = "#22c55e";

  const equityData = useMemo(
    () => buildEquityFromTrades(trades, startingBalance),
    [trades, startingBalance]
  );
  const markersForPlugin = useMemo(() => {
    const raw = buildMarkersFromTrades(trades);
    return raw.map((m) => ({
      time: m.time,
      position: m.position,
      shape: m.shape,
      color: m.color,
      text: m.text,
    }));
  }, [trades]);

  const initChart = useCallback(() => {
    if (!containerRef.current || equityData.length === 0) {
      return;
    }

    const chart = createChart(containerRef.current, {
      layout,
      grid,
      width: containerRef.current.clientWidth,
      height,
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.2 },
        autoScale: true,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: true, horzTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      crosshair: { vertLine: { visible: true }, horzLine: { visible: true } },
      autoSize: true,
    });

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: areaTopColor,
      bottomColor: areaBottomColor,
      lineWidth: 2,
      priceFormat: {
        type: "custom",
        formatter: (price: number) =>
          `₹${price.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      },
    });

    areaSeries.setData(equityData);

    const markersPlugin = createSeriesMarkers(areaSeries, markersForPlugin);
    markersPluginRef.current = markersPlugin;
    seriesRef.current = areaSeries;
    chartRef.current = chart;

    return () => {
      markersPlugin.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersPluginRef.current = null;
    };
  }, [
    equityData,
    markersForPlugin,
    layout,
    grid,
    height,
    areaTopColor,
    areaBottomColor,
  ]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const cleanup = initChart();
    return () => {
      cleanup?.();
    };
  }, [mounted, initChart]);

  useEffect(() => {
    if (!seriesRef.current || equityData.length === 0) {
      return;
    }
    seriesRef.current.setData(equityData);
    if (markersPluginRef.current) {
      markersPluginRef.current.setMarkers(markersForPlugin);
    }
  }, [equityData, markersForPlugin]);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }
    chartRef.current.applyOptions({ layout, grid });
    seriesRef.current?.applyOptions({
      lineColor,
      topColor: areaTopColor,
      bottomColor: areaBottomColor,
    });
  }, [layout, grid, areaTopColor, areaBottomColor]);

  if (equityData.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 w-full overflow-hidden rounded-lg border border-border/60 bg-muted/10">
      <div className="border-b border-border/60 px-3 py-2">
        <h4 className="text-sm font-semibold text-foreground">
          Equity curve — {symbol}
        </h4>
        <p className="text-muted-foreground text-xs">
          Cumulative PnL (zoom, pan, hover for values)
        </p>
      </div>
      <div ref={containerRef} style={{ height: `${height}px`, width: "100%" }} />
    </div>
  );
}
