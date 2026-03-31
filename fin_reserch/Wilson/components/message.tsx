"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import { Check, ChevronDown, ChevronUp, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Vote } from "@/lib/db/schema";
import type { HumanInLoopData } from "@/lib/human-in-loop";
import {
  extractHumanInLoopData,
  stripHumanInLoopBlock,
} from "@/lib/human-in-loop";
import { saveKnowledgeBaseItem } from "@/lib/knowledge-base";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./elements/tool";
import { EquityCurveChart } from "./equity-curve-chart";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";

/* ── Streaming phase detection ── */

type StreamPhase = "progress" | "tool-selected" | "content" | "done";

/**
 * Determine the current streaming phase of an assistant message.
 *
 * - `progress`      – progress bars are showing, no tool line yet
 * - `tool-selected` – "Using tool:" line arrived but real content hasn't
 * - `content`       – actual response content is streaming in
 * - `done`          – stream finished
 */
function getStreamingPhase(text: string, isStreaming: boolean): StreamPhase {
  if (!isStreaming) {
    return "done";
  }

  const hasProgress =
    text.includes("Processing request") ||
    /\[#{1,10}[.#]*\]/.test(text) ||
    text.includes("```timeline");

  if (!hasProgress) {
    // No progress bars / timeline → either content is streaming directly (AI model)
    // or it's an empty start — treat as content
    return "content";
  }

  const hasToolLine = text.includes("Using tool:");

  // Strip progress indicators, timeline blocks, and tool line to see if real content exists
  const stripped = text
    .replace(/Processing request\.\.\.\n*/g, "")
    .replace(/```text[\s\S]*?```\n*/g, "")
    .replace(/```timeline\s*[\s\S]*?```/g, "")
    .replace(/Using tool:.*\n*/g, "")
    .trim();

  if (stripped.length > 50) {
    return "content";
  }
  if (hasToolLine) {
    return "tool-selected";
  }
  return "progress";
}

/**
 * Extract the tool name from a "Using tool: `toolName`" line.
 */
function extractToolName(text: string): string | null {
  const m = text.match(/Using tool:\s*`([^`]+)`/);
  return m?.[1] ?? null;
}

/* ── Skeleton Components ── */

/** Skeleton placeholder for the "Using tool:" line before it arrives */
function ToolSelectionSkeleton() {
  return (
    <div className="mt-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
      <span className="text-sm text-muted-foreground">Selecting tool</span>
      <div className="h-5 w-32 rounded-md bg-muted animate-pulse skeleton-shimmer" />
    </div>
  );
}

/** Generic skeleton placeholder for response content */
function ResponseSkeleton() {
  return (
    <div className="mt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="space-y-2.5 rounded-xl border border-border/40 bg-muted/10 p-4">
        <div className="h-3.5 w-3/4 rounded-md bg-muted animate-pulse skeleton-shimmer" />
        <div
          className="h-3.5 w-full rounded-md bg-muted animate-pulse skeleton-shimmer"
          style={{ animationDelay: "100ms" }}
        />
        <div
          className="h-3.5 w-5/6 rounded-md bg-muted animate-pulse skeleton-shimmer"
          style={{ animationDelay: "200ms" }}
        />
        <div
          className="h-3.5 w-2/3 rounded-md bg-muted animate-pulse skeleton-shimmer"
          style={{ animationDelay: "300ms" }}
        />
      </div>
    </div>
  );
}

function StreamingLineResponse({ text }: { text: string }) {
  const safe = useMemo(() => sanitizeText(text).replace(/\r\n/g, "\n"), [text]);
  const lines = useMemo(() => safe.split("\n"), [safe]);
  const [visibleLineCount, setVisibleLineCount] = useState(() =>
    Math.min(lines.length, 1)
  );
  const revealTargetRef = useRef(visibleLineCount);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    revealTargetRef.current = lines.length;

    if (lines.length < visibleLineCount) {
      setVisibleLineCount(lines.length);
      return;
    }

    if (lines.length === visibleLineCount || revealTimerRef.current) {
      return;
    }

    const tick = () => {
      setVisibleLineCount((prev) => {
        const target = revealTargetRef.current;
        const backlog = target - prev;
        const step = backlog > 10 ? 3 : backlog > 5 ? 2 : 1;
        const next = Math.min(prev + step, target);

        if (next < target) {
          revealTimerRef.current = setTimeout(tick, 34);
        } else {
          revealTimerRef.current = null;
        }

        return next;
      });
    };

    revealTimerRef.current = setTimeout(tick, 18);
  }, [lines.length, visibleLineCount]);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-0.5 text-[15px] leading-relaxed">
      {lines.map((line, index) => {
        const isVisible = index < visibleLineCount;
        return (
          <div
            className={cn(
              "transform-gpu will-change-[opacity,transform] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              isVisible
                ? "translate-y-0 opacity-100"
                : "translate-y-1 opacity-0"
            )}
            key={`stream-line-${String(index)}`}
          >
            {line.length > 0 ? line : "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

/** Skeleton placeholder that mimics a backtest result table */
function BacktestSkeleton() {
  return (
    <div className="my-3 space-y-3 animate-in fade-in duration-150">
      {/* Summary bar skeleton */}
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
        <div className="h-4 w-32 rounded skeleton-shimmer" />
        <div
          className="h-4 w-24 rounded skeleton-shimmer"
          style={{ animationDelay: "80ms" }}
        />
        <div
          className="h-4 w-16 rounded skeleton-shimmer"
          style={{ animationDelay: "160ms" }}
        />
      </div>
      {/* Table skeleton */}
      <div className="overflow-hidden rounded-lg border">
        <div className="flex gap-6 border-b bg-muted/40 px-4 py-2.5">
          <div className="h-4 w-24 rounded skeleton-shimmer" />
          <div
            className="h-4 w-16 rounded skeleton-shimmer"
            style={{ animationDelay: "60ms" }}
          />
          <div
            className="h-4 w-20 rounded skeleton-shimmer"
            style={{ animationDelay: "120ms" }}
          />
          <div
            className="h-4 w-14 rounded skeleton-shimmer"
            style={{ animationDelay: "180ms" }}
          />
          <div
            className="h-4 w-16 rounded skeleton-shimmer"
            style={{ animationDelay: "240ms" }}
          />
        </div>
        {[0, 1, 2].map((i) => (
          <div
            className="flex gap-6 border-b px-4 py-2.5 last:border-b-0"
            key={`skel-row-${String(i)}`}
          >
            <div
              className="h-4 w-28 rounded skeleton-shimmer"
              style={{ animationDelay: `${300 + i * 80}ms` }}
            />
            <div
              className="h-4 w-14 rounded skeleton-shimmer"
              style={{ animationDelay: `${340 + i * 80}ms` }}
            />
            <div
              className="h-4 w-16 rounded skeleton-shimmer"
              style={{ animationDelay: `${380 + i * 80}ms` }}
            />
            <div
              className="h-4 w-10 rounded skeleton-shimmer"
              style={{ animationDelay: `${420 + i * 80}ms` }}
            />
            <div
              className="h-4 w-12 rounded skeleton-shimmer"
              style={{ animationDelay: `${460 + i * 80}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Tools used (picked for query) extraction & UI ── */

type ToolsUsedEntry = {
  order: number;
  tool_name: string;
  expected_output: string;
};

const TOOLS_USED_HEADER = "## Tools used for this query";

/**
 * Extract "Tools used for this query" table from streamed markdown
 * (injected by chat route when backend returns tools_picked).
 */
function extractToolsUsedBlock(text: string): ToolsUsedEntry[] | null {
  if (!text.includes(TOOLS_USED_HEADER)) {
    return null;
  }
  const tableStart = text.indexOf("| Step | Tool | Purpose |");
  if (tableStart === -1) {
    return null;
  }
  const afterHeader = text.slice(tableStart);
  const lineEnd = afterHeader.indexOf("\n\n---");
  const tableBlock =
    lineEnd === -1 ? afterHeader : afterHeader.slice(0, lineEnd);
  const lines = tableBlock
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.includes("---"));
  const rows = lines.slice(1);
  const out: ToolsUsedEntry[] = [];
  for (const row of rows) {
    const cells = row
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length >= 3) {
      const order = Number.parseInt(cells[0], 10);
      const tool_name = cells[1].replace(/\*\*/g, "").trim();
      const expected_output = cells[2];
      if (Number.isFinite(order) && tool_name.length > 0) {
        out.push({ order, tool_name, expected_output });
      }
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Remove "Tools used for this query" heading and table from text so it is not
 * shown again in the markdown body (we already show ToolsUsedCard above).
 * Matches our injected block (## ... table ... \n\n---) and any similar block.
 */
function stripToolsUsedBlock(text: string): string {
  const header = "Tools used for this query";
  if (!text.includes(header)) {
    return text;
  }
  // Match: optional ##, "Tools used for this query", then anything until \n\n--- or end
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `#{0,2}\\s*${escaped}[\\s\\S]*?(?=\\n\\n---|$)`,
    "g"
  );
  return text
    .replace(pattern, "")
    .replace(/\n\n---\n\n?/, "") // remove the separator that followed the block
    .trim();
}

function ToolsUsedCard({ tools }: { tools: ToolsUsedEntry[] }) {
  return (
    <div
      className="backtest-stagger my-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3"
      data-testid="tools-used-card"
    >
      <h3 className="mb-2.5 text-sm font-semibold text-foreground">
        Tools used for this query
      </h3>
      <ul className="space-y-2">
        {tools.map((t) => (
          <li
            className="flex items-start gap-3 text-sm"
            key={`${t.order}-${t.tool_name}`}
          >
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
              {t.order}
            </span>
            <div className="flex-1">
              <span className="font-medium text-foreground">{t.tool_name}</span>
              <span className="ml-1.5 text-muted-foreground">
                — {t.expected_output}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Execution timeline (step-by-step progress) ── */

export type TimelineStep = {
  label: string;
  subtitle?: ReactNode | null;
};

type TimelineIntentDecision = "goal-driven" | "conversation-driven";

type TimelineMeta = {
  intentOptions?: string[];
  toolOptions?: string[];
  intentDecision?: TimelineIntentDecision | string;
  selectedTools?: string[] | string | null;
};

export type TimelineData = {
  steps: TimelineStep[];
  status?: "in_progress" | "completed";
  meta?: TimelineMeta;
};

const TIMELINE_BLOCK_REGEX = /```timeline\s*([\s\S]*?)```/g;

/** Extract the last timeline block from streamed content (so we show final state). */
function extractTimelineData(text: string): TimelineData | null {
  const matches = [...text.matchAll(TIMELINE_BLOCK_REGEX)];
  const lastMatch = matches.at(-1);
  if (!lastMatch?.[1]) {
    return null;
  }
  try {
    const parsed = JSON.parse(lastMatch[1].trim()) as Record<string, unknown>;
    const steps = Array.isArray(parsed.steps)
      ? (parsed.steps as Array<{ label?: string; subtitle?: string | null }>)
          .filter((s) => typeof s?.label === "string")
          .map((s) => ({
            label: s.label as string,
            subtitle:
              typeof s.subtitle === "string" || s.subtitle === null
                ? s.subtitle
                : undefined,
          }))
      : [];
    if (steps.length === 0) {
      return null;
    }
    const status =
      parsed.status === "in_progress" || parsed.status === "completed"
        ? parsed.status
        : undefined;
    const metaRaw =
      parsed.meta && typeof parsed.meta === "object"
        ? (parsed.meta as Record<string, unknown>)
        : null;
    const intentOptions = Array.isArray(metaRaw?.intentOptions)
      ? (metaRaw?.intentOptions as unknown[])
          .filter((value) => typeof value === "string")
          .map((value) => String(value))
      : undefined;
    const toolOptions = Array.isArray(metaRaw?.toolOptions)
      ? (metaRaw?.toolOptions as unknown[])
          .filter((value) => typeof value === "string")
          .map((value) => String(value))
      : undefined;
    const intentDecision =
      typeof metaRaw?.intentDecision === "string"
        ? (metaRaw.intentDecision as string)
        : undefined;
    const selectedTools =
      typeof metaRaw?.selectedTools === "string"
        ? metaRaw.selectedTools
        : Array.isArray(metaRaw?.selectedTools)
          ? (metaRaw?.selectedTools as unknown[])
              .filter((value) => typeof value === "string")
              .map((value) => String(value))
          : undefined;
    const meta =
      intentOptions || toolOptions || intentDecision || selectedTools
        ? { intentOptions, toolOptions, intentDecision, selectedTools }
        : undefined;
    return { steps, status, meta };
  } catch {
    return null;
  }
}

function stripTimelineBlock(text: string): string {
  return text.replace(/```timeline\s*[\s\S]*?```/g, "").trim();
}

const DEFAULT_INTENT_OPTIONS = ["Goal driven", "Conversation driven"];
const DEFAULT_TOOL_OPTIONS = [
  "screener",
  "backtester",
  "suggest_strategy",
  "web_search",
];

function normalizeIntentDecision(
  raw: string | null | undefined
): TimelineIntentDecision | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase().replace(/\s+/g, "-");
  if (normalized === "goal-driven" || normalized === "goal") {
    return "goal-driven";
  }
  if (normalized === "conversation-driven" || normalized === "conversation") {
    return "conversation-driven";
  }
  return null;
}

function normalizeToolList(
  raw: string[] | string | null | undefined
): string[] {
  if (!raw) {
    return [];
  }
  if (typeof raw === "string") {
    return [raw];
  }
  return raw.filter((item) => item.trim().length > 0);
}

function useShuffleText(options: string[], active: boolean, intervalMs = 420) {
  const [index, setIndex] = useState(0);
  const optionsKey = useMemo(() => options.join("|"), [options]);

  useEffect(() => {
    if (!active || options.length < 2) {
      return;
    }
    let current = 0;
    const id = setInterval(() => {
      current = (current + 1) % options.length;
      setIndex(current);
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [active, intervalMs, optionsKey, options.length]);

  if (options.length === 0) {
    return "";
  }
  return options[index % options.length];
}

type TimelinePhase = "parsing" | "tool" | "running" | "done";
type StepStatus = "pending" | "active" | "completed";

type RenderStep = {
  label: string;
  subtitle?: ReactNode | null;
  status: StepStatus;
};

function ShuffledValue({
  value,
  active,
}: {
  value: string;
  active: boolean;
}) {
  return (
    <span
      key={`shuffle-${value}`}
      className={cn(
        "inline-block",
        active ? "animate-in fade-in duration-300 ease-out" : ""
      )}
    >
      {value}
    </span>
  );
}

function TimelineCard({ data }: { data: TimelineData }) {
  const [expanded, setExpanded] = useState(true);
  const intentOptions =
    data.meta?.intentOptions && data.meta.intentOptions.length > 0
      ? data.meta.intentOptions
      : DEFAULT_INTENT_OPTIONS;
  const toolOptions =
    data.meta?.toolOptions && data.meta.toolOptions.length > 0
      ? data.meta.toolOptions
      : DEFAULT_TOOL_OPTIONS;
  const intentTarget = normalizeIntentDecision(data.meta?.intentDecision);
  const selectedTools = normalizeToolList(data.meta?.selectedTools);

  const [phase, setPhase] = useState<TimelinePhase>("parsing");
  const [intentDecision, setIntentDecision] =
    useState<TimelineIntentDecision | null>(intentTarget);
  const [toolDecision, setToolDecision] = useState<string | null>(
    selectedTools[0] ?? null
  );

  const isCompleted = data.status === "completed";
  const inferredIntent = useMemo(() => {
    if (intentTarget) {
      return intentTarget;
    }
    if (!isCompleted) {
      return null;
    }
    const hasToolStep = data.steps.some((step) => {
      const subtitle =
        typeof step.subtitle === "string" ? step.subtitle : "";
      return (
        step.label.toLowerCase() === "selecting tool" ||
        subtitle.toLowerCase().includes("tool")
      );
    });
    return hasToolStep ? "goal-driven" : "conversation-driven";
  }, [data.steps, intentTarget, isCompleted]);

  useEffect(() => {
    if (intentDecision) {
      return;
    }
    const target = inferredIntent;
    if (!target) {
      return;
    }
    const delay = isCompleted ? 180 : 680;
    const timer = setTimeout(() => {
      setIntentDecision(target);
      setPhase(target === "goal-driven" ? "tool" : "running");
    }, delay);
    return () => clearTimeout(timer);
  }, [intentDecision, inferredIntent, isCompleted]);

  useEffect(() => {
    if (!intentTarget || intentTarget === intentDecision) {
      return;
    }
    setIntentDecision(intentTarget);
    if (phase === "done") {
      return;
    }
    if (intentTarget === "conversation-driven") {
      setPhase("running");
    } else if (phase === "parsing") {
      setPhase("tool");
    }
  }, [intentTarget, intentDecision, phase]);

  useEffect(() => {
    if (selectedTools.length === 0) {
      return;
    }
    if (!toolDecision || toolDecision !== selectedTools[0]) {
      setToolDecision(selectedTools[0]);
    }
  }, [selectedTools, toolDecision]);

  useEffect(() => {
    if (!intentDecision || phase !== "parsing") {
      return;
    }
    const delay = isCompleted ? 140 : 520;
    const timer = setTimeout(() => {
      setPhase(intentDecision === "goal-driven" ? "tool" : "running");
    }, delay);
    return () => clearTimeout(timer);
  }, [intentDecision, phase, isCompleted]);

  useEffect(() => {
    if (phase !== "parsing" || intentDecision || isCompleted) {
      return;
    }
    const timer = setTimeout(() => {
      setIntentDecision("goal-driven");
      setPhase("tool");
    }, 20_000);
    return () => clearTimeout(timer);
  }, [phase, intentDecision, isCompleted]);

  useEffect(() => {
    if (phase !== "tool" || !toolDecision) {
      return;
    }
    const delay = isCompleted ? 140 : 360;
    const timer = setTimeout(() => setPhase("running"), delay);
    return () => clearTimeout(timer);
  }, [phase, toolDecision, isCompleted]);

  useEffect(() => {
    if (!isCompleted || phase === "done") {
      return;
    }
    const timer = setTimeout(() => setPhase("done"), 220);
    return () => clearTimeout(timer);
  }, [phase, isCompleted]);

  const shuffledIntent = useShuffleText(intentOptions, phase === "parsing");
  const shuffledTool = useShuffleText(toolOptions, phase === "tool");

  const intentSubtitle = intentDecision ? (
    `Decision: ${
      intentDecision === "goal-driven" ? "Goal driven" : "Conversation driven"
    }`
  ) : (
    <>
      Deciding:{" "}
      <ShuffledValue
        value={shuffledIntent || "Goal driven"}
        active={phase === "parsing"}
      />
    </>
  );
  const toolSubtitle = toolDecision ? (
    `Selected: ${toolDecision}`
  ) : (
    <>
      Selecting:{" "}
      <ShuffledValue
        value={shuffledTool || toolOptions[0] || "tool"}
        active={phase === "tool"}
      />
    </>
  );

  const isGoalDriven = intentDecision === "goal-driven";

  const progressSteps: RenderStep[] = [
    {
      label: "Parsing intent",
      subtitle: intentSubtitle,
      status:
        phase === "parsing"
          ? "active"
          : "completed",
    },
  ];

  if (isGoalDriven) {
    progressSteps.push({
      label: "Selecting tool",
      subtitle: toolSubtitle,
      status:
        phase === "tool"
          ? "active"
          : phase === "parsing"
            ? "pending"
            : "completed",
    });
  }

  if (intentDecision) {
    progressSteps.push({
      label: "Running execution",
      status:
        phase === "running"
          ? "active"
          : phase === "done"
            ? "completed"
            : "pending",
    });
  }

  const showFinalSteps = isCompleted && phase === "done";
  const stepCount = showFinalSteps ? data.steps.length : progressSteps.length;
  const labelId = "timeline-label";
  const stepsToRender: Array<TimelineStep & { status?: StepStatus }> =
    showFinalSteps
      ? data.steps.map((step) => ({ ...step, status: "completed" }))
      : progressSteps;

  return (
    <div
      className="backtest-stagger my-3 block w-full overflow-hidden rounded-xl border border-border bg-muted/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
      data-testid="timeline-card"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="timeline-steps"
        id={labelId}
        className="flex w-full items-center justify-between gap-2 border-b border-border/60 bg-muted/50 px-4 py-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-sm font-medium text-foreground">
          Show timeline ({stepCount} {stepCount === 1 ? "step" : "steps"})
        </span>
        {expanded ? (
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      <section
        id="timeline-steps"
        aria-labelledby={labelId}
        className={expanded ? "block" : "hidden"}
      >
        <div className="px-4 py-3">
          <div className="relative flex flex-col">
            {/* Vertical line */}
            <div
              className="absolute left-[7px] top-2 bottom-2 w-px bg-primary/30"
              aria-hidden
            />
            {stepsToRender.map((step, index) => (
              <div
                className="relative flex items-start gap-3 pb-4 last:pb-0"
                key={`${step.label}-${index}`}
              >
                {step.status === "completed" ? (
                  <span
                    className="relative z-10 mt-1.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-background"
                    aria-hidden
                  >
                    <Check className="size-3" aria-hidden />
                  </span>
                ) : step.status === "active" ? (
                  <span
                    className="relative z-10 mt-1.5 flex size-4 shrink-0 rounded-full bg-primary ring-2 ring-background animate-pulse"
                    aria-hidden
                  />
                ) : (
                  <span
                    className="relative z-10 mt-1.5 flex size-4 shrink-0 rounded-full bg-muted ring-2 ring-background"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {step.label}
                  </p>
                  {step.subtitle ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {step.subtitle}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── Backtest result extraction & types ── */

type BacktestMetrics = {
  return_pct?: number;
  total_return?: number;
  total_trades?: number;
  win_rate?: number;
};

type BacktestTrade = {
  entry_date?: string;
  exit_date?: string;
  pnl?: number;
  pnl_pct?: number;
  exit_reason?: string;
};

type BacktestStockResult = {
  stock: string;
  success: boolean;
  metrics?: BacktestMetrics;
  trades?: BacktestTrade[];
};

type BacktestData = {
  summary?: {
    total_stocks?: number;
    successful?: number;
    failed?: number;
    execution_time?: number;
  };
  results?: Record<string, BacktestStockResult>;
};

/**
 * Extract backtest result data from a ```backtest-results code block
 * embedded by the Rust backend.
 */
function extractBacktestData(text: string): BacktestData | null {
  const match = text.match(/```backtest-results\s*([\s\S]*?)```/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1].trim()) as BacktestData;
  } catch {
    return null;
  }
}

/**
 * Remove the ```backtest-results block from the text so it doesn't
 * render as a raw code block in the markdown view.
 */
function stripBacktestDataBlock(text: string): string {
  return text
    .replace(
      /###\s*Backtest Results[\s\S]*?```backtest-results\s*[\s\S]*?```/g,
      ""
    )
    .replace(/```backtest-results\s*[\s\S]*?```/g, "")
    .trim();
}

/* ── Screener result extraction & types ── */

type ScreenerResult = {
  symbol: string;
  score?: number;
  [key: string]: unknown; // Allow additional fields from backend
};

type ScreenerData = {
  total_scanned?: number;
  total_matched?: number;
  results?: ScreenerResult[];
};

/**
 * Extract screener result data from a ```screener-results code block
 * embedded by the Rust backend.
 */
function extractScreenerData(text: string): ScreenerData | null {
  const match = text.match(/```screener-results\s*([\s\S]*?)```/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1].trim()) as ScreenerData;
  } catch {
    return null;
  }
}

/**
 * Remove the ```screener-results block and summary text from the text so it doesn't
 * render as a raw code block or duplicate the summary in the markdown view.
 */
function stripScreenerDataBlock(text: string): string {
  return text
    .replace(/```screener-results\s*[\s\S]*?```/g, "")
    .replace(/.*Total Scanned.*Total Matched.*\n*/g, "")
    .trim();
}

/* ── Strategy result extraction & types ── */

type StrategyRule = {
  name?: string;
  rules?: string[];
  timeframe?: string;
  type?: string;
  confidence?: number;
  sources?: string[];
  [key: string]: unknown; // Allow additional fields from backend
};

type StrategyData = {
  stocks?: string[];
  strategies?: StrategyRule[];
  meta?: {
    totalSources?: number;
    generatedAt?: string;
  };
  disclaimer?: string;
  [key: string]: unknown; // Allow additional fields from backend
};

/**
 * Extract strategy result data from a ```strategy-results code block
 * embedded by the Rust backend.
 */
function extractStrategyData(text: string): StrategyData | null {
  const match = text.match(/```strategy-results\s*([\s\S]*?)```/);
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1].trim()) as StrategyData;
  } catch {
    return null;
  }
}

/**
 * Remove the ```strategy-results block and summary text from the text so it doesn't
 * render as a raw code block or duplicate the summary in the markdown view.
 */
function stripStrategyDataBlock(text: string): string {
  return text
    .replace(/```strategy-results\s*[\s\S]*?```/g, "")
    .replace(/.*Stocks:.*\n*/g, "")
    .replace(/.*Strategies Found:.*\n*/g, "")
    .trim();
}

/* ── Human-in-the-loop (missing backtest fields) ── */

/** Card shown when the agent is waiting for user to provide missing backtest fields */
function HumanInLoopCard({ data }: { data: HumanInLoopData }) {
  const hasRequired = data.missing_required && data.missing_required.length > 0;
  const hasOptional = data.missing_optional && data.missing_optional.length > 0;

  return (
    <output
      aria-live="polite"
      className="mt-4 block w-full overflow-hidden rounded-xl border border-border bg-muted/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
    >
      <div className="flex items-start gap-3 border-b border-border/60 bg-muted/50 px-4 py-3">
        <span
          aria-hidden
          className="flex shrink-0 rounded-full bg-primary/10 p-1.5 text-primary"
        >
          <MessageCircle className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your input needed
          </p>
          <p className="mt-0.5 text-sm font-medium text-foreground">
            {data.message ??
              "Additional information needed before backtesting."}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {hasRequired && (
              <span>
                <span className="font-medium text-foreground">Required: </span>
                {(data.missing_required ?? []).join(" · ")}
              </span>
            )}
            {hasOptional && (
              <span>
                <span className="font-medium text-foreground">Optional: </span>
                {(data.missing_optional ?? []).join(" · ")}
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="px-4 py-2.5 text-xs text-muted-foreground">
        {hasRequired
          ? "Reply in the input below with these details so I can continue."
          : data.can_proceed_without
            ? 'Reply with more detail below, or say "proceed without" to continue with defaults.'
            : "Reply in the input below to continue."}
      </p>
    </output>
  );
}

/* ── Backtest Result Table Component ── */

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000_000) {
    return `₹${(value / 10_000_000).toFixed(2)}Cr`;
  }
  if (abs >= 100_000) {
    return `₹${(value / 100_000).toFixed(2)}L`;
  }
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function PnlCell({ value, suffix }: { value?: number; suffix?: string }) {
  if (value === undefined || value === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const isPositive = value > 0;
  const isNeg = value < 0;
  return (
    <span
      className={cn(
        "font-medium",
        isPositive && "text-emerald-600 dark:text-emerald-400",
        isNeg && "text-red-500 dark:text-red-400"
      )}
    >
      {isPositive ? "+" : ""}
      {suffix === "%" ? `${value.toFixed(2)}%` : formatCurrency(value)}
    </span>
  );
}

function BacktestResultTable({ data }: { data: BacktestData }) {
  const { summary, results } = data;
  const stocks = results ? Object.entries(results) : [];

  return (
    <div className="my-3 space-y-4 text-sm">
      {/* Summary bar */}
      {summary && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
          <span className="font-semibold">Backtest Summary</span>
          <span className="text-muted-foreground">•</span>
          <span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {summary.successful ?? 0}
            </span>
            /{summary.total_stocks ?? 0} stocks successful
          </span>
          {(summary.failed ?? 0) > 0 && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-red-500">{summary.failed} failed</span>
            </>
          )}
          <span className="text-muted-foreground">•</span>
          <span className="text-muted-foreground">
            {(summary.execution_time ?? 0).toFixed(2)}s
          </span>
        </div>
      )}

      {/* Per-stock metrics table */}
      {stocks.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 font-semibold">Stock</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  Return %
                </th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  Total Return
                </th>
                <th className="px-4 py-2.5 text-right font-semibold">Trades</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  Win Rate
                </th>
              </tr>
            </thead>
            <tbody>
              {stocks.map(([symbol, result]) => {
                const m = result.metrics;
                return (
                  <tr
                    className="border-b last:border-b-0 transition-colors hover:bg-muted/20"
                    key={symbol}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      {symbol}
                      {!result.success && (
                        <span className="ml-1 text-red-500" title="Failed">
                          ⚠️
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PnlCell suffix="%" value={m?.return_pct} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <PnlCell value={m?.total_return} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {m?.total_trades ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {m?.win_rate !== undefined ? (
                        <span className="font-medium">
                          {m.win_rate.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-stock trades */}
      {stocks.map(([symbol, result]) => {
        const trades = result.trades;
        if (!trades || trades.length === 0) {
          return null;
        }
        return (
          <div key={`trades-${symbol}`}>
            <h4 className="mb-1.5 font-semibold text-xs uppercase tracking-wide text-muted-foreground">
              Trades — {symbol}
            </h4>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Entry</th>
                    <th className="px-3 py-2 font-semibold">Exit</th>
                    <th className="px-3 py-2 font-semibold">Exit reason</th>
                    <th className="px-3 py-2 text-right font-semibold">PnL</th>
                    <th className="px-3 py-2 text-right font-semibold">
                      PnL %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => (
                    <tr
                      className="border-b last:border-b-0 transition-colors hover:bg-muted/20"
                      key={`${symbol}-${trade.entry_date ?? "na"}-${trade.exit_date ?? "na"}`}
                    >
                      <td className="px-3 py-2 text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2">{trade.entry_date ?? "—"}</td>
                      <td className="px-3 py-2">{trade.exit_date ?? "—"}</td>
                      <td className="px-3 py-2">{trade.exit_reason ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <PnlCell value={trade.pnl} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <PnlCell suffix="%" value={trade.pnl_pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <EquityCurveChart
              startingBalance={100_000}
              symbol={symbol}
              trades={trades}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ── Screener Result Table Component ── */

function ScreenerResultTable({ data }: { data: ScreenerData }) {
  const { total_scanned, total_matched, results } = data;
  const sortedResults = results
    ? [...results].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : [];

  return (
    <div className="my-3 space-y-4 text-sm">
      {/* Summary bar */}
      {(total_scanned !== undefined || total_matched !== undefined) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
          <span className="font-semibold">Screener Results</span>
          {total_scanned !== undefined && (
            <>
              <span className="text-muted-foreground">•</span>
              <span>
                <span className="font-medium text-foreground">
                  {total_scanned.toLocaleString()}
                </span>{" "}
                scanned
              </span>
            </>
          )}
          {total_matched !== undefined && (
            <>
              <span className="text-muted-foreground">•</span>
              <span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {total_matched.toLocaleString()}
                </span>{" "}
                matched
              </span>
            </>
          )}
        </div>
      )}

      {/* Results table */}
      {sortedResults.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 font-semibold">Rank</th>
                <th className="px-4 py-2.5 font-semibold">Stock</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  Screener Score
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((result, index) => (
                <tr
                  className="border-b last:border-b-0 transition-colors hover:bg-muted/20"
                  key={result.symbol}
                >
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{result.symbol}</td>
                  <td className="px-4 py-2.5 text-right">
                    {result.score !== undefined ? (
                      <span className="font-medium">{result.score}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center text-muted-foreground">
          No matching stocks found.
        </div>
      )}
    </div>
  );
}

/* ── Strategy Result Component ── */

function StrategyResultTable({ data }: { data: StrategyData }) {
  const { stocks, strategies, meta, disclaimer } = data;
  const strategyList = strategies || [];
  const stockList = stocks || [];

  // Sort strategies by confidence (highest first)
  const sortedStrategies = [...strategyList].sort((a, b) => {
    const confA = a.confidence ?? 0;
    const confB = b.confidence ?? 0;
    return confB - confA;
  });

  return (
    <div className="my-3 space-y-4 text-sm">
      {/* Summary bar */}
      {(stockList.length > 0 || strategyList.length > 0 || meta) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
          <span className="font-semibold">Strategy Suggestions</span>
          {stockList.length > 0 && (
            <>
              <span className="text-muted-foreground">•</span>
              <span>
                <span className="font-medium text-foreground">
                  {stockList.join(", ")}
                </span>
              </span>
            </>
          )}
          {strategyList.length > 0 && (
            <>
              <span className="text-muted-foreground">•</span>
              <span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {strategyList.length}
                </span>{" "}
                {strategyList.length === 1 ? "strategy" : "strategies"} found
              </span>
            </>
          )}
          {meta?.totalSources && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">
                {meta.totalSources}{" "}
                {meta.totalSources === 1 ? "source" : "sources"}
              </span>
            </>
          )}
        </div>
      )}

      {/* Strategy list */}
      {sortedStrategies.length > 0 ? (
        <div className="space-y-3">
          {sortedStrategies.map((strategy, index) => (
            <div
              className="rounded-lg border bg-muted/20 p-4 transition-colors hover:bg-muted/30"
              key={strategy.name ?? `strategy-${index}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    Strategy {index + 1}
                    {strategy.type && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({strategy.type})
                      </span>
                    )}
                  </span>
                </div>
                {strategy.confidence !== undefined && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {(strategy.confidence * 100).toFixed(0)}% confidence
                  </span>
                )}
              </div>
              {strategy.name && (
                <div className="mb-2 font-medium text-foreground">
                  {strategy.name}
                </div>
              )}
              {strategy.rules && strategy.rules.length > 0 && (
                <div className="mb-2 space-y-1">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Rules:
                  </div>
                  <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                    {strategy.rules.map((rule) => (
                      <li className="text-xs" key={rule}>
                        {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {strategy.timeframe && (
                  <span>Timeframe: {strategy.timeframe}</span>
                )}
                {strategy.sources && strategy.sources.length > 0 && (
                  <span>Sources: {strategy.sources.join(", ")}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center text-muted-foreground">
          No strategy suggestions available.
        </div>
      )}

      {/* Disclaimer */}
      {disclaimer && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-semibold">⚠️ Disclaimer:</span> {disclaimer}
        </div>
      )}
    </div>
  );
}

/* ── Defaults from the /api/v1/backtest/run-config spec ── */
const BACKTEST_DEFAULTS = {
  initial_capital: 100_000,
  position_size: 15,
  stop_loss: 5,
  take_profit: 15,
  exit_after_days: 5,
  date_config: { start_date: "2024-01-01", end_date: "2025-01-01" } as Record<
    string,
    unknown
  >,
} as const;

type StrategyBacktestPayload = {
  /** Backtest-ready JSON string */
  configJson: string;
  /** Human-readable list of defaults that were filled in */
  appliedDefaults: string[];
};

/**
 * Clean an AST condition to only keep fields the backtest API expects:
 * left, operator, right.
 */
function cleanCondition(
  cond: Record<string, unknown>
): Record<string, unknown> {
  return {
    left: cond.left,
    operator: cond.operator,
    right: cond.right,
  };
}

/**
 * Clean the AST to the backtest API format: only entry[] and exit[]
 * with each condition having only left/operator/right.
 */
function cleanAst(ast: Record<string, unknown>): Record<string, unknown> {
  const hasEntryExit = Array.isArray(ast.entry) || Array.isArray(ast.exit);
  const hasSequenceStages = Array.isArray(ast.stages);

  // Preserve sequence/staged AST as-is (required by backend for this strategy type).
  if (hasSequenceStages) {
    return { ...ast };
  }

  // Preserve unknown AST shapes as-is instead of dropping fields.
  if (!hasEntryExit) {
    return { ...ast };
  }

  const cleaned: Record<string, unknown> = {};
  if (Array.isArray(ast.entry)) {
    cleaned.entry = (ast.entry as Record<string, unknown>[]).map(
      cleanCondition
    );
  }
  if (Array.isArray(ast.exit)) {
    cleaned.exit = (ast.exit as Record<string, unknown>[]).map(cleanCondition);
  }
  return cleaned;
}

/**
 * Map date_conditions from the parse/strategy_builder response format
 * to the run-config format the backtest API expects.
 *
 * Strategy builder returns (various shapes):
 *   { "type": "exclude_month", "months": ["march"] }
 *   { "type": "skip_month", "month": "march" }
 *
 * Backtest run-config expects:
 *   { "exclude": true, "months": ["march"], "type": "month" }
 *   { "type": "skip_holiday" }  (passed through as-is)
 */
function mapDateCondition(
  cond: Record<string, unknown>
): Record<string, unknown> {
  const srcType = typeof cond.type === "string" ? cond.type : "";

  // exclude_month / skip_month / month_event → { exclude: true, months: [...], type: "month" }
  if (
    srcType === "exclude_month" ||
    srcType === "skip_month" ||
    srcType === "month_event"
  ) {
    // months may be an array already or a singular "month" string
    let months: string[] = [];
    if (Array.isArray(cond.months)) {
      months = cond.months as string[];
    } else if (typeof cond.month === "string") {
      months = [cond.month];
    }
    return { exclude: true, months, type: "month" };
  }

  // skip_holiday and others → pass through as-is
  return { ...cond };
}

/**
 * Check whether date_config has meaningful explicit start/end dates.
 * Only explicit date strings count — `is_relative` / `relative_value`
 * are NOT forwarded to the backtest API.
 */
function hasRealDateConfig(srcDate: Record<string, unknown>): boolean {
  const startDate = srcDate.start_date;
  const endDate = srcDate.end_date;

  return (
    (typeof startDate === "string" && startDate.length > 0) ||
    (typeof endDate === "string" && endDate.length > 0)
  );
}

/**
 * Build a backtest-ready config from the strategy parse response.
 *
 * Structure & field order matches `/api/v1/backtest/run-config`:
 *   ast, date_conditions, date_config, exit_after_days, risk_params, stocks
 *
 * Required: ast, date_config, risk_params, stocks (always present; defaults when missing).
 * Optional: date_conditions, exit_after_days (preserve parsed values; apply defaults when missing).
 * `appliedDefaults` lists every default that was used so the user can be prompted.
 */
function buildBacktestConfig(
  parsed: Record<string, unknown>
): StrategyBacktestPayload | null {
  const ast = parsed.ast as Record<string, unknown> | undefined;
  if (!ast || typeof ast !== "object") {
    return null;
  }

  const appliedDefaults: string[] = [];

  // ── 1. ast (required) ──
  const cleanedAst = cleanAst(ast);

  // ── 2. date_conditions (optional; send [] when none) ──
  const dateConditions =
    Array.isArray(parsed.date_conditions) && parsed.date_conditions.length > 0
      ? (parsed.date_conditions as Record<string, unknown>[]).map(
          mapDateCondition
        )
      : [];

  // ── 3. date_config (required) ──
  const srcDate =
    parsed.date_config && typeof parsed.date_config === "object"
      ? (parsed.date_config as Record<string, unknown>)
      : {};

  let dateConfig: Record<string, string>;
  if (hasRealDateConfig(srcDate)) {
    dateConfig = {};
    if (
      typeof srcDate.start_date === "string" &&
      srcDate.start_date.length > 0
    ) {
      dateConfig.start_date = srcDate.start_date;
    }
    if (typeof srcDate.end_date === "string" && srcDate.end_date.length > 0) {
      dateConfig.end_date = srcDate.end_date;
    }
  } else {
    dateConfig = {
      start_date: "2024-01-01",
      end_date: "2025-01-01",
    };
    appliedDefaults.push("date_config = 2024-01-01 to 2025-01-01");
  }

  // ── 4. exit_after_days (optional; default 5) ──
  const parsedExitAfterDays =
    typeof parsed.exit_after_days === "number" ? parsed.exit_after_days : null;
  const astMaxWaitCandles =
    typeof ast.max_wait_candles === "number" ? ast.max_wait_candles : null;
  const exitAfterDays =
    parsedExitAfterDays ??
    astMaxWaitCandles ??
    (() => {
      appliedDefaults.push(
        `exit_after_days = ${String(BACKTEST_DEFAULTS.exit_after_days)}`
      );
      return BACKTEST_DEFAULTS.exit_after_days;
    })();

  // ── 5. risk_params (required) ──
  const srcRisk =
    parsed.risk_params && typeof parsed.risk_params === "object"
      ? (parsed.risk_params as Record<string, unknown>)
      : {};

  const initialCapital =
    typeof srcRisk.initial_capital === "number"
      ? srcRisk.initial_capital
      : null;
  const positionSize =
    typeof srcRisk.position_size === "number" ? srcRisk.position_size : null;
  const stopLoss =
    typeof srcRisk.stop_loss === "number" ? srcRisk.stop_loss : null;
  const takeProfit =
    typeof srcRisk.take_profit === "number" ? srcRisk.take_profit : null;

  const riskParams: Record<string, number> = {
    initial_capital:
      initialCapital ??
      (() => {
        appliedDefaults.push(
          `initial_capital = ${String(BACKTEST_DEFAULTS.initial_capital)}`
        );
        return BACKTEST_DEFAULTS.initial_capital;
      })(),
    position_size:
      positionSize ??
      (() => {
        appliedDefaults.push(
          `position_size = ${String(BACKTEST_DEFAULTS.position_size)}`
        );
        return BACKTEST_DEFAULTS.position_size;
      })(),
    stop_loss:
      stopLoss ??
      (() => {
        appliedDefaults.push(
          `stop_loss = ${String(BACKTEST_DEFAULTS.stop_loss)}`
        );
        return BACKTEST_DEFAULTS.stop_loss;
      })(),
    take_profit:
      takeProfit ??
      (() => {
        appliedDefaults.push(
          `take_profit = ${String(BACKTEST_DEFAULTS.take_profit)}`
        );
        return BACKTEST_DEFAULTS.take_profit;
      })(),
  };

  // ── 6. stocks (required; default [] when missing) ──
  const stocks = Array.isArray(parsed.stocks)
    ? (parsed.stocks as string[])
    : [];

  const config: Record<string, unknown> = {
    ast: cleanedAst,
    date_conditions: dateConditions,
    date_config: dateConfig,
    exit_after_days: exitAfterDays,
    risk_params: riskParams,
    stocks,
  };

  return {
    configJson: JSON.stringify(config, null, 2),
    appliedDefaults,
  };
}

function extractStrategyBacktestPayload(
  message: ChatMessage
): StrategyBacktestPayload | null {
  if (message.role !== "assistant") {
    return null;
  }

  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  if (!text.includes("strategy_builder")) {
    return null;
  }

  const jsonBlocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)]
    .map((m) => m[1]?.trim())
    .filter((s): s is string => Boolean(s && s.length > 0));

  const looksLikeAstObject = (value: Record<string, unknown>) =>
    Array.isArray(value.entry) ||
    Array.isArray(value.exit) ||
    Array.isArray(value.stages) ||
    value.type === "sequence";

  for (let i = jsonBlocks.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(jsonBlocks[i]) as Record<string, unknown>;

      // Strategy-builder output may be top-level or nested under `data`.
      const topPayload = buildBacktestConfig(parsed);
      if (topPayload) {
        return topPayload;
      }
      const nested =
        parsed.data && typeof parsed.data === "object"
          ? (parsed.data as Record<string, unknown>)
          : null;
      if (nested) {
        const nestedPayload = buildBacktestConfig(nested);
        if (nestedPayload) {
          return nestedPayload;
        }
      }

      // Legacy fallback: JSON block may be raw AST object (without top-level `ast`).
      if (looksLikeAstObject(parsed)) {
        const payloadFromRawAst = buildBacktestConfig({
          ast: parsed,
          ...parsed,
        });
        if (payloadFromRawAst) {
          return payloadFromRawAst;
        }
      }
    } catch {
      // Ignore non-JSON blocks.
    }
  }

  return null;
}

function extractScreenerDataFromMessage(
  message: ChatMessage
): ScreenerData | null {
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i];
    if (part.type !== "text") {
      continue;
    }
    const data = extractScreenerData(part.text);
    if (data) {
      return data;
    }
  }
  return null;
}

function extractStrategyDataFromMessage(
  message: ChatMessage
): StrategyData | null {
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i];
    if (part.type !== "text") {
      continue;
    }
    const data = extractStrategyData(part.text);
    if (data) {
      return data;
    }
  }
  return null;
}

function normalizeBacktestLaunchPromptForDisplay(text: string): string {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return text;
  }

  if (
    /^backtest on the ast built/i.test(normalized) &&
    /```json\s*[\s\S]*?```/i.test(normalized)
  ) {
    return "backtest on the ast built";
  }

  if (
    /^run backtest with the following config/i.test(normalized) &&
    /```json\s*[\s\S]*?```/i.test(normalized)
  ) {
    return "backtest on the ast built";
  }

  return text;
}

function summarizeScreenerForKnowledge(data: ScreenerData) {
  const matched =
    typeof data.total_matched === "number" ? data.total_matched : undefined;
  const scanned =
    typeof data.total_scanned === "number" ? data.total_scanned : undefined;
  const title =
    matched !== undefined
      ? `Screener: ${matched} matched`
      : "Saved screener result";
  const summaryParts: string[] = [];
  if (matched !== undefined) {
    summaryParts.push(`${matched} matched`);
  }
  if (scanned !== undefined) {
    summaryParts.push(`${scanned} scanned`);
  }
  return { title, summary: summaryParts.join(" · ") };
}

function summarizeStrategyForKnowledge(data: StrategyData) {
  const strategiesCount = Array.isArray(data.strategies)
    ? data.strategies.length
    : 0;
  const stocksCount = Array.isArray(data.stocks) ? data.stocks.length : 0;
  const title =
    strategiesCount > 0
      ? `Strategy: ${strategiesCount} suggestion${strategiesCount > 1 ? "s" : ""}`
      : "Saved strategy result";
  const summaryParts: string[] = [];
  if (strategiesCount > 0) {
    summaryParts.push(`${strategiesCount} strategy`);
  }
  if (stocksCount > 0) {
    summaryParts.push(`${stocksCount} stock`);
  }
  return { title, summary: summaryParts.join(" · ") };
}

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  sendMessage,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  isLastMessage,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  isLastMessage?: boolean;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const strategyPayload = extractStrategyBacktestPayload(message);
  const strategyResultForSave = extractStrategyDataFromMessage(message);
  const screenerResultForSave = extractScreenerDataFromMessage(message);
  const saveToKnowledgeBase = useCallback(
    async (
      type: "strategy" | "screener",
      payload: StrategyData | ScreenerData
    ) => {
      const summary =
        type === "strategy"
          ? summarizeStrategyForKnowledge(payload as StrategyData)
          : summarizeScreenerForKnowledge(payload as ScreenerData);
      try {
        await saveKnowledgeBaseItem({
          type,
          title: summary.title,
          summary: summary.summary,
          chatId,
          messageId: message.id,
          payload,
        });
        toast.success(`Saved ${type} to Knowledge Base`);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : `Failed to save ${type} to Knowledge Base`
        );
      }
    },
    [chatId, message.id]
  );

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn("flex flex-col", {
            "gap-2 md:gap-4": message.parts?.some(
              (p) => p.type === "text" && p.text?.trim()
            ),
            "items-end": message.role === "user" && mode !== "edit",
            "w-full":
              (message.role === "assistant" &&
                (message.parts?.some(
                  (p) => p.type === "text" && p.text?.trim()
                ) ||
                  message.parts?.some((p) => p.type.startsWith("tool-")))) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(85%,42rem)]":
              message.role === "user" && mode !== "edit",
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {message.parts?.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === "reasoning") {
              const hasContent = part.text?.trim().length > 0;
              const isStreaming = "state" in part && part.state === "streaming";
              if (hasContent || isStreaming) {
                return (
                  <MessageReasoning
                    isLoading={isLoading || isStreaming}
                    key={key}
                    reasoning={part.text || ""}
                  />
                );
              }
            }

            if (type === "text") {
              if (mode === "view") {
                const isAssistant = message.role === "assistant";
                const backtestData = isAssistant
                  ? extractBacktestData(part.text)
                  : null;
                const screenerData = isAssistant
                  ? extractScreenerData(part.text)
                  : null;
                const strategyData = isAssistant
                  ? extractStrategyData(part.text)
                  : null;
                const humanInLoopData = isAssistant
                  ? extractHumanInLoopData(part.text)
                  : null;
                const toolsUsedData = isAssistant
                  ? extractToolsUsedBlock(part.text)
                  : null;
                const timelineData = isAssistant
                  ? extractTimelineData(part.text)
                  : null;
                let displayText = backtestData
                  ? stripBacktestDataBlock(part.text)
                  : part.text;
                displayText = screenerData
                  ? stripScreenerDataBlock(displayText)
                  : displayText;
                displayText = strategyData
                  ? stripStrategyDataBlock(displayText)
                  : displayText;
                displayText = humanInLoopData
                  ? stripHumanInLoopBlock(displayText)
                  : displayText;
                if (
                  humanInLoopData?.message &&
                  displayText.trim() === humanInLoopData.message.trim()
                ) {
                  displayText = "";
                }
                if (
                  humanInLoopData &&
                  displayText.includes("Goal-driven execution completed")
                ) {
                  displayText = displayText
                    .replace(/Goal-driven execution completed\.?\s*/gi, "")
                    .trim();
                }
                if (
                  humanInLoopData &&
                  isLastMessage &&
                  displayText.trim().length > 0
                ) {
                  displayText = "";
                }
                displayText = toolsUsedData
                  ? stripToolsUsedBlock(displayText)
                  : displayText;
                displayText = timelineData
                  ? stripTimelineBlock(displayText)
                  : displayText;
                if (timelineData) {
                  displayText = displayText
                    .replace(/Processing request\.\.\.\n*/g, "")
                    .trim();
                }
                if (!isAssistant) {
                  displayText =
                    normalizeBacktestLaunchPromptForDisplay(displayText);
                }

                // Streaming phase detection
                const phase = isAssistant
                  ? getStreamingPhase(part.text, isLoading)
                  : ("done" as StreamPhase);

                const showToolSkeleton = phase === "progress" && !timelineData;
                const showResponseSkeleton =
                  phase === "progress" || phase === "tool-selected";

                // Determine if a backtest, screener, or strategy skeleton should be shown
                // (tool-selected phase with backtester/screener/suggest_strategy tool, or already
                // streaming content but table data not yet complete)
                const toolName =
                  phase === "tool-selected" ? extractToolName(part.text) : null;
                const isBacktestIncoming = toolName === "backtester";
                const isScreenerIncoming = toolName === "screener";
                const isStrategyIncoming = toolName === "suggest_strategy";
                const isBacktestStreaming =
                  isAssistant &&
                  isLoading &&
                  part.text.includes("### Backtest Results") &&
                  !backtestData;
                const isScreenerStreaming =
                  isAssistant &&
                  isLoading &&
                  (part.text.includes("Total Scanned") ||
                    part.text.includes("Total Matched")) &&
                  !screenerData;
                const isStrategyStreaming =
                  isAssistant &&
                  isLoading &&
                  (part.text.includes("Strategies Found") ||
                    part.text.includes("```strategy-results")) &&
                  !strategyData;
                const useLineFadeStreaming =
                  isAssistant &&
                  isLoading &&
                  phase === "content" &&
                  !backtestData &&
                  !screenerData &&
                  !strategyData;

                return (
                  <div key={key}>
                    <MessageContent
                      className={cn({
                        "ml-auto w-fit rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/12 to-primary/5 px-4 py-2.5 text-left text-foreground shadow-[0_8px_20px_rgba(0,0,0,0.06)] backdrop-blur-sm":
                          !isAssistant,
                        "bg-transparent px-0 py-0 text-left": isAssistant,
                      })}
                      data-testid="message-content"
                    >
                      {timelineData && (
                        <TimelineCard data={timelineData} />
                      )}
                      {toolsUsedData && !timelineData && (
                        <ToolsUsedCard tools={toolsUsedData} />
                      )}
                      {useLineFadeStreaming ? (
                        <StreamingLineResponse text={displayText} />
                      ) : (
                        <Response
                          className={
                            isAssistant
                              ? undefined
                              : "text-left [&_blockquote]:text-left [&_h1]:text-left [&_h2]:text-left [&_h3]:text-left [&_li]:text-left [&_p]:text-left"
                          }
                        >
                          {sanitizeText(displayText)}
                        </Response>
                      )}
                    </MessageContent>

                    {/* Tool selection skeleton */}
                    {showToolSkeleton && <ToolSelectionSkeleton />}

                    {/* Response / backtest / screener / strategy skeleton while waiting */}
                    {showResponseSkeleton &&
                      (isBacktestIncoming ||
                      isScreenerIncoming ||
                      isStrategyIncoming ? (
                        <BacktestSkeleton />
                      ) : (
                        <ResponseSkeleton />
                      ))}

                    {/* Backtest table streaming skeleton */}
                    {isBacktestStreaming && <BacktestSkeleton />}

                    {/* Screener table streaming skeleton */}
                    {isScreenerStreaming && <BacktestSkeleton />}

                    {/* Strategy table streaming skeleton */}
                    {isStrategyStreaming && <BacktestSkeleton />}

                    {/* Final backtest table with stagger animation */}
                    {backtestData && (
                      <div className="backtest-stagger">
                        <BacktestResultTable data={backtestData} />
                      </div>
                    )}

                    {/* Final screener table with stagger animation */}
                    {screenerData && (
                      <div className="backtest-stagger">
                        <ScreenerResultTable data={screenerData} />
                      </div>
                    )}

                    {/* Final strategy table with stagger animation */}
                    {strategyData && (
                      <div className="backtest-stagger">
                        <StrategyResultTable data={strategyData} />
                      </div>
                    )}

                    {/* Human-in-the-loop card only when not last (extension above input shows for last) */}
                    {humanInLoopData && !isLastMessage && (
                      <HumanInLoopCard data={humanInLoopData} />
                    )}
                  </div>
                );
              }

              if (mode === "edit") {
                return (
                  <div
                    className="flex w-full flex-row items-start gap-3"
                    key={key}
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        regenerate={regenerate}
                        setMessages={setMessages}
                        setMode={setMode}
                      />
                    </div>
                  </div>
                );
              }
            }

            if (type === "tool-getWeather") {
              const { toolCallId, state } = part;
              const approvalId = (part as { approval?: { id: string } })
                .approval?.id;
              const isDenied =
                state === "output-denied" ||
                (state === "approval-responded" &&
                  (part as { approval?: { approved?: boolean } }).approval
                    ?.approved === false);
              const widthClass = "w-[min(100%,450px)]";

              if (state === "output-available") {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Weather weatherAtLocation={part.output} />
                  </div>
                );
              }

              if (isDenied) {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Tool className="w-full" defaultOpen={true}>
                      <ToolHeader
                        state="output-denied"
                        type="tool-getWeather"
                      />
                      <ToolContent>
                        <div className="px-4 py-3 text-muted-foreground text-sm">
                          Weather lookup was denied.
                        </div>
                      </ToolContent>
                    </Tool>
                  </div>
                );
              }

              if (state === "approval-responded") {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Tool className="w-full" defaultOpen={true}>
                      <ToolHeader state={state} type="tool-getWeather" />
                      <ToolContent>
                        <ToolInput input={part.input} />
                      </ToolContent>
                    </Tool>
                  </div>
                );
              }

              return (
                <div className={widthClass} key={toolCallId}>
                  <Tool className="w-full" defaultOpen={true}>
                    <ToolHeader state={state} type="tool-getWeather" />
                    <ToolContent>
                      {(state === "input-available" ||
                        state === "approval-requested") && (
                        <ToolInput input={part.input} />
                      )}
                      {state === "approval-requested" && approvalId && (
                        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                          <button
                            className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => {
                              addToolApprovalResponse({
                                id: approvalId,
                                approved: false,
                                reason: "User denied weather lookup",
                              });
                            }}
                            type="button"
                          >
                            Deny
                          </button>
                          <button
                            className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                            onClick={() => {
                              addToolApprovalResponse({
                                id: approvalId,
                                approved: true,
                              });
                            }}
                            type="button"
                          >
                            Allow
                          </button>
                        </div>
                      )}
                    </ToolContent>
                  </Tool>
                </div>
              );
            }

            if (type === "tool-createDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error creating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <DocumentPreview
                  isReadonly={isReadonly}
                  key={toolCallId}
                  result={part.output}
                />
              );
            }

            if (type === "tool-updateDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error updating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <div className="relative" key={toolCallId}>
                  <DocumentPreview
                    args={{ ...part.output, isUpdate: true }}
                    isReadonly={isReadonly}
                    result={part.output}
                  />
                </div>
              );
            }

            if (type === "tool-requestSuggestions") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-requestSuggestions" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={
                          "error" in part.output ? (
                            <div className="rounded border p-2 text-red-500">
                              Error: {String(part.output.error)}
                            </div>
                          ) : (
                            <DocumentToolResult
                              isReadonly={isReadonly}
                              result={part.output}
                              type="request-suggestions"
                            />
                          )
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            return null;
          })}

          {/* Fallback skeleton when assistant is loading but no text parts yet */}
          {isLoading &&
            message.role === "assistant" &&
            !message.parts?.some(
              (p) => p.type === "text" && p.text?.trim()
            ) && <ResponseSkeleton />}

          {!isReadonly &&
            message.role === "assistant" &&
            (strategyPayload ||
              strategyResultForSave ||
              screenerResultForSave) && (
              <div className="pt-1">
                {strategyPayload &&
                  strategyPayload.appliedDefaults.length > 0 && (
                    <p className="mb-1.5 text-muted-foreground text-xs">
                      Defaults applied:{" "}
                      {strategyPayload.appliedDefaults.join(", ")}
                    </p>
                  )}
                <div className="flex flex-wrap items-center gap-2">
                  {strategyPayload && (
                    <button
                      className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isLoading}
                      onClick={() => {
                        sendMessage({
                          role: "user",
                          parts: [
                            {
                              type: "text",
                              text:
                                "backtest on the ast built\n\n" +
                                "```json\n" +
                                strategyPayload.configJson +
                                "\n```",
                            },
                          ],
                        });
                      }}
                      type="button"
                    >
                      Backtest Strategy
                    </button>
                  )}

                  {strategyResultForSave && (
                    <button
                      className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isLoading}
                      onClick={() => {
                        saveToKnowledgeBase("strategy", strategyResultForSave);
                      }}
                      type="button"
                    >
                      Save Strategy
                    </button>
                  )}

                  {screenerResultForSave && (
                    <button
                      className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isLoading}
                      onClick={() => {
                        saveToKnowledgeBase("screener", screenerResultForSave);
                      }}
                      type="button"
                    >
                      Save Screener
                    </button>
                  )}
                </div>
              </div>
            )}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message fade-in w-full animate-in duration-150"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex w-full max-w-2xl flex-col gap-2">
          <div className="text-muted-foreground text-sm">
            Preparing response...
          </div>
          <div className="space-y-2.5 rounded-xl border border-border/40 bg-muted/10 p-4">
            <div className="h-3.5 w-3/4 rounded-md bg-muted animate-pulse skeleton-shimmer" />
            <div
              className="h-3.5 w-full rounded-md bg-muted animate-pulse skeleton-shimmer"
              style={{ animationDelay: "100ms" }}
            />
            <div
              className="h-3.5 w-5/6 rounded-md bg-muted animate-pulse skeleton-shimmer"
              style={{ animationDelay: "200ms" }}
            />
            <div
              className="h-3.5 w-2/3 rounded-md bg-muted animate-pulse skeleton-shimmer"
              style={{ animationDelay: "300ms" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
