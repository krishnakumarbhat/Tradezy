"use client";

import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HumanInLoopData } from "@/lib/human-in-loop";
import { cn } from "@/lib/utils";

const STORAGE_KEY_PREFIX = "clarifying-kv-";

type TabId = "required" | "optional";
type FieldValues = Record<string, string>;

function normalizeFieldValues(
  fields: string[],
  values?: FieldValues | null
): FieldValues {
  const out: FieldValues = {};
  for (const field of fields) {
    out[field] = values?.[field] ?? "";
  }
  return out;
}

function readStoredValues(storageKey: string, fields: string[]): FieldValues {
  if (typeof window === "undefined") {
    return normalizeFieldValues(fields);
  }
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) {
      return normalizeFieldValues(fields);
    }
    const parsed = JSON.parse(raw) as FieldValues;
    return normalizeFieldValues(fields, parsed);
  } catch {
    return normalizeFieldValues(fields);
  }
}

function toParamLines(fields: string[], values: FieldValues): string[] {
  return fields
    .map((field) => {
      const value = values[field]?.trim() ?? "";
      if (!value) {
        return null;
      }
      return `${field}: ${value}`;
    })
    .filter((line): line is string => line != null);
}

function placeholderForField(field: string): string {
  const lower = field.toLowerCase();
  if (lower.includes("stock")) {
    return "RELIANCE.NS";
  }
  if (lower.includes("time range")) {
    return "2024-01-01 to 2025-01-01";
  }
  if (lower.includes("initial capital")) {
    return "100000";
  }
  if (lower.includes("position size")) {
    return "15";
  }
  if (lower.includes("stop loss")) {
    return "3";
  }
  if (lower.includes("take profit") || lower.includes("profit")) {
    return "6";
  }
  if (lower.includes("exit after days")) {
    return "7";
  }
  if (lower.includes("max wait candles")) {
    return "3";
  }
  if (lower.includes("entry price type")) {
    return "open";
  }
  if (lower.includes("exit price type")) {
    return "close";
  }
  if (lower.includes("date conditions")) {
    return "month=mar, skip_holidays=true";
  }
  if (lower.includes("time frame")) {
    return "intraday, swing, or daily";
  }
  return "Enter value";
}

function defaultValueForRequiredField(field: string): string | null {
  const lower = field.toLowerCase();
  if (lower.includes("stock")) {
    return "RELIANCE.NS";
  }
  if (lower.includes("time range")) {
    return "2024-01-01 to 2025-01-01";
  }
  if (lower.includes("initial capital")) {
    return "100000";
  }
  if (lower.includes("position size")) {
    return "15";
  }
  if (lower.includes("stop loss")) {
    return "5";
  }
  if (lower.includes("take profit") || lower.includes("profit")) {
    return "15";
  }
  return null;
}

export function ClarifyingQuestionExtension({
  chatId,
  data,
  onSkip,
  onSubmit,
  onEscape,
}: {
  chatId: string;
  data: HumanInLoopData;
  onSkip: () => void;
  onSubmit: (text: string) => void;
  onEscape: () => void;
}) {
  const requiredFields = useMemo(
    () => data.missing_required ?? [],
    [data.missing_required]
  );
  const optionalFields = useMemo(
    () => data.missing_optional ?? [],
    [data.missing_optional]
  );

  const hasRequired = requiredFields.length > 0;
  const hasOptional = optionalFields.length > 0;
  const hasTwoTabs = hasRequired && hasOptional;

  const requiredStorageKey = `${STORAGE_KEY_PREFIX}${chatId}-required`;
  const optionalStorageKey = `${STORAGE_KEY_PREFIX}${chatId}-optional`;

  const [tab, setTab] = useState<TabId>(hasRequired ? "required" : "optional");
  const [requiredValues, setRequiredValues] = useState<FieldValues>(() =>
    readStoredValues(requiredStorageKey, requiredFields)
  );
  const [optionalValues, setOptionalValues] = useState<FieldValues>(() =>
    readStoredValues(optionalStorageKey, optionalFields)
  );

  useEffect(() => {
    setRequiredValues((prev) => normalizeFieldValues(requiredFields, prev));
  }, [requiredFields]);

  useEffect(() => {
    setOptionalValues((prev) => normalizeFieldValues(optionalFields, prev));
  }, [optionalFields]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    sessionStorage.setItem(requiredStorageKey, JSON.stringify(requiredValues));
  }, [requiredStorageKey, requiredValues]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    sessionStorage.setItem(optionalStorageKey, JSON.stringify(optionalValues));
  }, [optionalStorageKey, optionalValues]);

  const clearDraft = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      sessionStorage.removeItem(requiredStorageKey);
      sessionStorage.removeItem(optionalStorageKey);
    } catch {
      // ignore
    }
  }, [requiredStorageKey, optionalStorageKey]);

  const requiredLines = toParamLines(requiredFields, requiredValues);
  const optionalLines = toParamLines(optionalFields, optionalValues);
  const combinedParams = [...requiredLines, ...optionalLines].join("\n");

  const requiredFilled = requiredFields.filter(
    (field) => (requiredValues[field] ?? "").trim().length > 0
  ).length;

  const canProceedFromRequired =
    !hasRequired || requiredFilled === requiredFields.length;

  const handleSubmit = useCallback(() => {
    if (!canProceedFromRequired) {
      return;
    }
    clearDraft();
    onSubmit(combinedParams);
  }, [canProceedFromRequired, clearDraft, combinedParams, onSubmit]);

  const handleSkipOptional = useCallback(() => {
    if (!canProceedFromRequired) {
      return;
    }
    clearDraft();
    if (hasRequired) {
      onSubmit(requiredLines.join("\n"));
    } else {
      onSkip();
    }
  }, [
    canProceedFromRequired,
    clearDraft,
    hasRequired,
    onSkip,
    onSubmit,
    requiredLines,
  ]);

  const handleUseDefaultsForRequired = useCallback(() => {
    if (!hasRequired) {
      return;
    }

    const mergedValues: FieldValues = { ...requiredValues };
    for (const field of requiredFields) {
      if ((mergedValues[field] ?? "").trim().length > 0) {
        continue;
      }
      const fallback = defaultValueForRequiredField(field);
      if (fallback) {
        mergedValues[field] = fallback;
      }
    }

    const lines = toParamLines(requiredFields, mergedValues);
    if (lines.length === 0) {
      return;
    }

    clearDraft();
    onSubmit(lines.join("\n"));
  }, [clearDraft, hasRequired, onSubmit, requiredFields, requiredValues]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (tab === "required" && hasTwoTabs && canProceedFromRequired) {
          setTab("optional");
          return;
        }
        if (canProceedFromRequired) {
          handleSubmit();
        }
      }
    },
    [canProceedFromRequired, handleSubmit, hasTwoTabs, onEscape, tab]
  );

  const renderFieldRows = (
    fields: string[],
    values: FieldValues,
    onChange: (field: string, value: string) => void
  ) => {
    if (fields.length === 0) {
      return (
        <p className="text-xs text-muted-foreground">No fields required.</p>
      );
    }

    return (
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-2 pb-1">
          {fields.map((field) => (
            <div
              className="grid grid-cols-1 items-center gap-2 rounded-md border border-border/60 bg-background/70 p-2.5 md:grid-cols-[minmax(0,250px)_1fr]"
              key={field}
            >
              <div
                className="truncate text-[12px] font-medium text-foreground"
                title={field}
              >
                {field}
              </div>
              <Input
                className="h-8 text-sm"
                maxLength={250}
                onChange={(e) => onChange(field, e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholderForField(field)}
                value={values[field] ?? ""}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  const actionHint = (
    <span className="text-[11px] text-muted-foreground">
      <kbd className="rounded border border-border bg-muted/60 px-1 font-mono">
        ⌘↵
      </kbd>{" "}
      send
      {" · "}
      <kbd className="rounded border border-border bg-muted/60 px-1 font-mono">
        Esc
      </kbd>{" "}
      skip
    </span>
  );

  return (
    <div
      aria-labelledby="clarifying-question-banner"
      aria-live="polite"
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-muted/40 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.2)]",
        "min-h-[48px]",
        "animate-in fade-in slide-in-from-bottom-2 duration-200 fill-mode-both",
        "[@media(prefers-reduced-motion:reduce)]:transition-none"
      )}
      role="dialog"
      style={{ maxHeight: "min(72vh, 560px)", minHeight: 220 }}
    >
      <div
        className={cn(
          "flex items-start gap-3 border-b border-border/60 bg-muted/50 px-4 py-3",
          "rounded-t-2xl"
        )}
        id="clarifying-question-banner"
      >
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
            {data.message ?? "Additional information needed."}
          </p>
          {hasTwoTabs && (
            <div
              aria-label="Required and optional fields"
              className="mt-3 flex items-center gap-0.5 rounded-lg bg-muted/80 p-0.5"
              role="tablist"
            >
              <Button
                aria-label="Previous tab (Required)"
                className="h-6 w-6 shrink-0 p-0"
                disabled={tab === "required"}
                onClick={() => setTab("required")}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <button
                aria-controls="clarifying-required-panel"
                aria-selected={tab === "required"}
                className={cn(
                  "flex-1 rounded-md px-2.5 py-1 text-center text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-transparent",
                  tab === "required"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                id="clarifying-tab-required"
                onClick={() => setTab("required")}
                role="tab"
                type="button"
              >
                Required ({requiredFilled}/{requiredFields.length})
              </button>
              <button
                aria-controls="clarifying-optional-panel"
                aria-selected={tab === "optional"}
                className={cn(
                  "flex-1 rounded-md px-2.5 py-1 text-center text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-transparent",
                  tab === "optional"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                id="clarifying-tab-optional"
                onClick={() => setTab("optional")}
                role="tab"
                type="button"
              >
                Optional ({optionalLines.length}/{optionalFields.length})
              </button>
              <Button
                aria-label="Next tab (Optional)"
                className="h-6 w-6 shrink-0 p-0"
                disabled={tab === "optional"}
                onClick={() => setTab("optional")}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
        {tab === "required" && (
          <div
            aria-labelledby="clarifying-tab-required"
            className="flex min-h-0 flex-1 flex-col gap-2"
            id="clarifying-required-panel"
            role="tabpanel"
          >
            {renderFieldRows(requiredFields, requiredValues, (field, value) =>
              setRequiredValues((prev) => ({ ...prev, [field]: value }))
            )}
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 pt-2">
              {actionHint}
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleUseDefaultsForRequired}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Use defaults
                </Button>
                {hasTwoTabs ? (
                  <Button
                    disabled={!canProceedFromRequired}
                    onClick={() => setTab("optional")}
                    size="sm"
                    type="button"
                  >
                    Next <ChevronRight className="ml-0.5 size-3.5" />
                  </Button>
                ) : (
                  <Button
                    disabled={!canProceedFromRequired}
                    onClick={handleSubmit}
                    size="sm"
                    type="button"
                  >
                    Add context
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "optional" && (
          <div
            aria-labelledby="clarifying-tab-optional"
            className="flex min-h-0 flex-1 flex-col gap-2"
            id="clarifying-optional-panel"
            role="tabpanel"
          >
            {renderFieldRows(optionalFields, optionalValues, (field, value) =>
              setOptionalValues((prev) => ({ ...prev, [field]: value }))
            )}
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 pt-2">
              {actionHint}
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setTab("required")}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <ChevronLeft className="mr-0.5 size-3.5" /> Back
                </Button>
                {hasOptional && (
                  <Button
                    onClick={handleSkipOptional}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Skip
                  </Button>
                )}
                <Button
                  disabled={!canProceedFromRequired}
                  onClick={handleSubmit}
                  size="sm"
                  type="button"
                >
                  Add context
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
