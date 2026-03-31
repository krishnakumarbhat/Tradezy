import { geolocation } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  type UIMessageStreamWriter,
} from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 120;
const RUST_REQUEST_TIMEOUT_MS = 120_000;
const RUST_MAX_ATTEMPTS = 1;
const TIMELINE_INTENT_OPTIONS = ["Goal driven", "Conversation driven"];
const TIMELINE_TOOL_OPTIONS = [
  "screener",
  "backtester",
  "suggest_strategy",
  "web_search",
];

type RustChatRequest = {
  chat_id?: string;
  tenant_id?: string;
  user_id?: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
};

type RustApiResponse = {
  success: boolean;
  data?: unknown;
  error?: string | null;
  timestamp?: string;
};

/** One tool step selected for the query (from Rust backend tools_picked). */
export type ToolStepSummary = {
  order: number;
  tool_name: string;
  expected_output: string;
};

type RustAnswerPayload = {
  answer: string;
  toolName?: string;
  summary?: string;
  /** Tools picked for this query (order, name, expected output) — show in UI */
  tools_picked?: ToolStepSummary[];
  /** e.g. "success" | "partial_success" | "awaiting_user_input" from backend */
  status?: string;
  /** When status is partial_success, optional message from backend */
  partial_success_message?: string;
  /** Human-in-the-loop: backtest missing required/optional fields */
  human_in_loop?: boolean;
  missing_required?: string[];
  missing_optional?: string[];
  can_proceed_without?: boolean;
};

function extractRustErrorMessage(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as RustApiResponse;
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    // Keep raw response text when body is not JSON.
  }
  return responseText;
}

function splitFieldList(raw: string): string[] {
  return raw
    .split(",")
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

function mapRustErrorToHumanInLoop(
  rustErrorMessage: string
): RustAnswerPayload | null {
  const normalized = rustErrorMessage.toLowerCase();

  if (
    normalized.includes(
      "backtest run-config requires at least one stock in 'stocks'"
    )
  ) {
    return {
      answer:
        "I need at least one stock symbol before I can run this backtest. Please provide a stock (for example: RELIANCE.NS, AAPL, or MSFT).",
      toolName: "backtester",
      status: "awaiting_user_input",
      human_in_loop: true,
      missing_required: ["Stocks"],
      missing_optional: [],
      can_proceed_without: false,
    };
  }

  if (
    normalized.includes("could not detect any stock or index") ||
    (normalized.includes("suggest_strategy") &&
      normalized.includes("stock or index"))
  ) {
    return {
      answer:
        "I need a stock or index to suggest a strategy. Please provide a valid NSE/BSE ticker or company name.",
      toolName: "suggest_strategy",
      status: "awaiting_user_input",
      human_in_loop: true,
      missing_required: ["Stock or index (NSE/BSE ticker or company name)"],
      missing_optional: ["Time frame (intraday, swing, or daily)"],
      can_proceed_without: false,
    };
  }

  const requiredMatch = rustErrorMessage.match(
    /These fields are required for backtesting:\s*([^.?]+)[.?]/i
  );
  const optionalMatch = rustErrorMessage.match(
    /These optional fields are missing:\s*([^.?]+)[.?]/i
  );

  const required = requiredMatch?.[1] ? splitFieldList(requiredMatch[1]) : [];
  const optional = optionalMatch?.[1] ? splitFieldList(optionalMatch[1]) : [];

  if (required.length > 0 || optional.length > 0) {
    return {
      answer:
        required.length > 0
          ? "I need a bit more information before I can run this backtest. Please provide the required fields."
          : "You can provide the optional fields for a more precise backtest, or continue without them.",
      toolName: "backtester",
      status: "awaiting_user_input",
      human_in_loop: true,
      missing_required: required,
      missing_optional: optional,
      can_proceed_without: required.length === 0,
    };
  }

  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamChunkedText({
  dataStream,
  textId,
  text,
  chunkSize = 80,
  delayMs = 10,
}: {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  textId: string;
  text: string;
  chunkSize?: number;
  delayMs?: number;
}) {
  if (!text) {
    return;
  }

  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    dataStream.write({
      type: "text-delta",
      id: textId,
      delta: chunk,
    });
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

function segmentFakeStreamText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const segments: string[] = [];
  let current: string[] = [];
  let inCodeFence = false;

  const flushCurrent = () => {
    const joined = current.join("\n").trim();
    if (joined.length > 0) {
      segments.push(joined);
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      current.push(line);
      continue;
    }

    const isHardDivider = !inCodeFence && trimmed === "---";
    const isHeaderBoundary =
      !inCodeFence && (trimmed === "**Summary**" || trimmed.startsWith("### "));

    if ((isHardDivider || isHeaderBoundary) && current.length > 0) {
      flushCurrent();
    }

    if (isHardDivider) {
      segments.push("---");
      continue;
    }

    current.push(line);

    if (!inCodeFence && trimmed === "" && current.join("\n").length > 900) {
      flushCurrent();
    }
  }

  flushCurrent();
  return segments;
}

async function streamStagedFakeText({
  dataStream,
  textId,
  text,
}: {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  textId: string;
  text: string;
}) {
  const segments = segmentFakeStreamText(text);
  if (segments.length === 0) {
    return;
  }

  for (const segment of segments) {
    if (segment === "---") {
      dataStream.write({
        type: "text-delta",
        id: textId,
        delta: "\n\n---\n\n",
      });
      await sleep(120);
      continue;
    }

    const lines = segment.split("\n");
    let inCodeFence = false;
    for (const rawLine of lines) {
      const line = rawLine ?? "";
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        inCodeFence = !inCodeFence;
      }

      const isHeader = /^#{1,3}\s/.test(trimmed) || trimmed === "**Summary**";
      const isTable = line.includes("|");
      const lineWithBreak = `${line}\n`;

      if (line.length > 220 && !inCodeFence) {
        await streamChunkedText({
          dataStream,
          textId,
          text: lineWithBreak,
          chunkSize: 110,
          delayMs: 7,
        });
      } else {
        dataStream.write({
          type: "text-delta",
          id: textId,
          delta: lineWithBreak,
        });
      }

      await sleep(
        isHeader
          ? 120
          : isTable || inCodeFence
            ? 55
            : trimmed.length === 0
              ? 30
              : 70
      );
    }

    await sleep(80);
  }
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

function toRustChatMessages(
  messages: ChatMessage[]
): RustChatRequest["messages"] {
  const normalized = messages
    .map((message) => {
      const content = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();

      return {
        role: message.role,
        content,
      };
    })
    .filter((message) => message.content.length > 0);

  // Keep request payload bounded for Cloud Run stability.
  return normalized.slice(-24);
}

function parseToolsPicked(raw: unknown): ToolStepSummary[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const out: ToolStepSummary[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const order =
        typeof o.order === "number"
          ? o.order
          : typeof o.order === "string"
            ? Number.parseInt(o.order, 10)
            : Number.NaN;
      const tool_name =
        typeof o.tool_name === "string"
          ? o.tool_name
          : String(o.tool_name ?? "");
      const expected_output =
        typeof o.expected_output === "string"
          ? o.expected_output
          : String(o.expected_output ?? "");
      if (Number.isFinite(order) && tool_name.length > 0) {
        out.push({ order, tool_name, expected_output });
      }
    }
  }
  return out.length > 0 ? out.sort((a, b) => a.order - b.order) : undefined;
}

function extractRustAnswer(data: unknown): RustAnswerPayload {
  if (typeof data === "string") {
    return { answer: data };
  }

  if (data && typeof data === "object") {
    const pickString = (...values: unknown[]) => {
      for (const value of values) {
        if (typeof value === "string" && value.length > 0) {
          return value;
        }
      }
      return undefined;
    };

    const payload = data as Record<string, unknown>;
    let toolName =
      typeof payload.tool_name === "string" ? payload.tool_name : undefined;

    const result = payload.result;
    let resultPayload: Record<string, unknown> | undefined;
    if (result && typeof result === "object") {
      resultPayload = result as Record<string, unknown>;
      if (typeof resultPayload.tool_name === "string") {
        toolName = resultPayload.tool_name;
      } else if (typeof resultPayload.toolName === "string") {
        toolName = resultPayload.toolName;
      }
    }

    const resultData =
      resultPayload?.data && typeof resultPayload.data === "object"
        ? (resultPayload.data as Record<string, unknown>)
        : undefined;

    const summary = pickString(
      payload.summary,
      resultPayload?.summary,
      resultData?.summary
    );
    const answer = pickString(
      payload.answer,
      payload.message,
      resultPayload?.answer,
      resultPayload?.message,
      resultData?.answer,
      resultData?.message,
      summary
    );

    const tools_picked =
      parseToolsPicked(payload.tools_picked) ??
      parseToolsPicked(resultPayload?.tools_picked as unknown);
    const status =
      typeof payload.status === "string"
        ? payload.status
        : typeof resultPayload?.status === "string"
          ? resultPayload.status
          : undefined;
    const partial_success_message =
      status === "partial_success" &&
      resultPayload &&
      typeof resultPayload.message === "string"
        ? resultPayload.message
        : undefined;

    const human_in_loop =
      status === "awaiting_user_input" &&
      resultPayload != null &&
      resultPayload.human_in_loop === true;
    const missing_required =
      human_in_loop &&
      resultPayload != null &&
      Array.isArray(resultPayload.missing_required)
        ? (resultPayload.missing_required as string[])
        : undefined;
    const missing_optional =
      human_in_loop &&
      resultPayload != null &&
      Array.isArray(resultPayload.missing_optional)
        ? (resultPayload.missing_optional as string[])
        : undefined;
    const can_proceed_without =
      human_in_loop &&
      resultPayload != null &&
      typeof resultPayload.can_proceed_without === "boolean"
        ? resultPayload.can_proceed_without
        : undefined;

    const base = {
      toolName,
      summary,
      tools_picked,
      status,
      partial_success_message,
      human_in_loop: human_in_loop ? true : undefined,
      missing_required,
      missing_optional,
      can_proceed_without,
    };

    if (answer !== undefined) {
      return { answer, ...base };
    }

    return {
      answer: JSON.stringify(payload, null, 2),
      ...base,
    };
  }

  return { answer: "No response returned by Rust service." };
}

async function callRustChatService({
  rustApiUrl,
  messages,
  chatId,
  userId,
}: {
  rustApiUrl: string;
  messages: ChatMessage[];
  chatId: string;
  userId: string;
}): Promise<RustAnswerPayload> {
  const rustMessages = toRustChatMessages(messages);

  if (rustMessages.length === 0) {
    throw new ChatSDKError(
      "bad_request:api",
      "No text messages available to send to Rust service."
    );
  }

  const body = JSON.stringify({
    chat_id: String(chatId),
    tenant_id: String(process.env.RUST_TENANT_ID ?? "default"),
    user_id: String(userId),
    messages: rustMessages,
  } satisfies RustChatRequest);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= RUST_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      RUST_REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch(
        `${rustApiUrl.replace(/\/$/, "")}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Source": "nextjs",
          },
          body,
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const responseText = await response.text();
        const rustErrorMessage = extractRustErrorMessage(responseText);
        const clarificationPayload =
          mapRustErrorToHumanInLoop(rustErrorMessage);
        if (clarificationPayload) {
          return clarificationPayload;
        }
        throw new ChatSDKError(
          "bad_request:api",
          `Rust service error (${response.status}): ${responseText}`
        );
      }

      const payload = (await response.json()) as RustApiResponse;

      if (!payload.success) {
        const rustErrorMessage =
          payload.error ?? "Rust service returned an error";
        const clarificationPayload =
          mapRustErrorToHumanInLoop(rustErrorMessage);
        if (clarificationPayload) {
          return clarificationPayload;
        }
        throw new ChatSDKError("bad_request:api", rustErrorMessage);
      }

      const parsed = extractRustAnswer(payload.data);
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt === RUST_MAX_ATTEMPTS) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new ChatSDKError(
      "offline:chat",
      "Rust service timed out. Please retry."
    );
  }

  if (lastError instanceof ChatSDKError) {
    throw lastError;
  }

  throw new ChatSDKError("offline:chat", "Rust service request failed.");
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError("forbidden:chat").toResponse();
      }
      if (!isToolApprovalFlow) {
        messagesFromDb = await getMessagesByChatId({ id });
      }
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    const uiMessages = isToolApprovalFlow
      ? (messages as ChatMessage[])
      : [...convertToUIMessages(messagesFromDb), message as ChatMessage];

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    if (message?.role === "user") {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }

    const isReasoningModel =
      selectedChatModel.includes("reasoning") ||
      selectedChatModel.includes("thinking");

    const modelMessages = await convertToModelMessages(uiMessages);
    const rustApiUrl = process.env.RUST_API_URL;

    const stream = createUIMessageStream({
      originalMessages: isToolApprovalFlow ? uiMessages : undefined,
      execute: async ({ writer: dataStream }) => {
        if (rustApiUrl) {
          const textId = generateUUID();
          dataStream.write({
            type: "text-start",
            id: textId,
          });
          const initialTimelineSteps = [
            { label: "Parsing intent" },
            { label: "Selecting tool" },
            { label: "Running execution" },
          ];
          const initialTimelineMeta = {
            intentOptions: TIMELINE_INTENT_OPTIONS,
            toolOptions: TIMELINE_TOOL_OPTIONS,
          };
          const initialTimelineBlock = `\`\`\`timeline\n${JSON.stringify({
            steps: initialTimelineSteps,
            status: "in_progress",
            meta: initialTimelineMeta,
          })}\n\`\`\`\n\n`;

          dataStream.write({
            type: "text-delta",
            id: textId,
            delta: `Processing request...\n\n${initialTimelineBlock}`,
          });

          try {
            const rustResponse = await callRustChatService({
              rustApiUrl,
              messages: uiMessages,
              chatId: id,
              userId: session.user.id,
            });

            const toolsPicked = rustResponse.tools_picked;
            let prefix = "";

            const completedTimelineSteps: Array<{
              label: string;
              subtitle?: string;
            }> = [{ label: "Parsing intent" }];
            const isGoalDriven = Boolean(
              (toolsPicked && toolsPicked.length > 0) || rustResponse.toolName
            );
            if (isGoalDriven) {
              completedTimelineSteps.push({ label: "Selecting tool" });
            }

            if (toolsPicked && toolsPicked.length > 0) {
              for (const t of toolsPicked) {
                completedTimelineSteps.push({
                  label: t.expected_output,
                  subtitle: "Tool Execution",
                });
              }
            } else if (rustResponse.toolName) {
              const toolLabel =
                rustResponse.toolName === "screener"
                  ? "Getting AI Screener Query Results"
                  : rustResponse.toolName === "backtester"
                    ? "Running backtest"
                    : rustResponse.toolName === "suggest_strategy"
                      ? "Getting strategy suggestions"
                      : `Running ${rustResponse.toolName}`;
              completedTimelineSteps.push({
                label: toolLabel,
                subtitle: "Tool Execution",
              });
            } else {
              completedTimelineSteps.push({ label: "Running execution" });
            }

            const selectedTools =
              toolsPicked && toolsPicked.length > 0
                ? toolsPicked.map((tool) => tool.tool_name)
                : rustResponse.toolName
                  ? [rustResponse.toolName]
                  : [];

            const completedTimelineMeta = {
              intentOptions: TIMELINE_INTENT_OPTIONS,
              toolOptions: TIMELINE_TOOL_OPTIONS,
              intentDecision: isGoalDriven ? "goal-driven" : "conversation-driven",
              selectedTools,
            };

            const completedTimelineBlock = `\`\`\`timeline\n${JSON.stringify({
              steps: completedTimelineSteps,
              status: "completed",
              meta: completedTimelineMeta,
            })}\n\`\`\`\n\n`;

            if (toolsPicked && toolsPicked.length > 0) {
              prefix = completedTimelineBlock;
            } else if (rustResponse.toolName) {
              prefix =
                completedTimelineBlock +
                `Using tool: \`${rustResponse.toolName}\`\n\n`;
            } else {
              prefix = completedTimelineBlock;
            }

            if (prefix) {
              await streamChunkedText({
                dataStream,
                textId,
                text: prefix,
                chunkSize: 60,
                delayMs: 8,
              });
            }

            let mainContent = rustResponse.answer;
            if (
              rustResponse.status === "partial_success" &&
              rustResponse.partial_success_message
            ) {
              mainContent = `> ⚠️ **Partial success:** ${rustResponse.partial_success_message}\n\n${mainContent}`;
            }

            if (
              rustResponse.status === "awaiting_user_input" &&
              rustResponse.human_in_loop
            ) {
              const humanInLoopBlock = JSON.stringify({
                message: rustResponse.answer,
                missing_required: rustResponse.missing_required ?? [],
                missing_optional: rustResponse.missing_optional ?? [],
                can_proceed_without: rustResponse.can_proceed_without ?? false,
              });
              mainContent = `${mainContent}\n\n\`\`\`human-in-loop\n${humanInLoopBlock}\n\`\`\``;
            }

            const showSummaryAlongside =
              rustResponse.status !== "awaiting_user_input" &&
              rustResponse.summary &&
              mainContent !== rustResponse.summary &&
              (rustResponse.toolName === "web_search" ||
                rustResponse.toolName === "suggest_strategy");
            const contentToStream = showSummaryAlongside
              ? `**Summary**\n\n${rustResponse.summary}\n\n---\n\n${mainContent}`
              : mainContent;

            const useDirectStreamingForTool =
              rustResponse.toolName === "backtester" ||
              rustResponse.toolName === "screener" ||
              rustResponse.tools_picked?.some(
                (t) => t.tool_name === "backtester" || t.tool_name === "screener"
              );

            if (useDirectStreamingForTool) {
              dataStream.write({
                type: "text-delta",
                id: textId,
                delta: contentToStream,
              });
            } else {
              await streamStagedFakeText({
                dataStream,
                textId,
                text: contentToStream,
              });
            }
          } catch (error) {
            // ChatSDKError stores the actual Rust detail in `cause`
            // while `message` is a generic user-facing string.
            // Surface the cause so the user can see what went wrong.
            let detail: string;
            if (error instanceof ChatSDKError) {
              detail =
                typeof error.cause === "string" && error.cause.length > 0
                  ? error.cause
                  : error.message;
            } else if (error instanceof Error) {
              detail = error.message;
            } else {
              detail = "Unknown error. Please retry.";
            }

            dataStream.write({
              type: "text-delta",
              id: textId,
              delta: `Rust service error: ${detail}`,
            });
          }
          dataStream.write({
            type: "text-end",
            id: textId,
          });

          if (titlePromise) {
            const title = await titlePromise;
            dataStream.write({ type: "data-chat-title", data: title });
            updateChatTitleById({ chatId: id, title });
          }

          return;
        }

        const result = streamText({
          model: getLanguageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: modelMessages,
          stopWhen: stepCountIs(5),
          experimental_activeTools: isReasoningModel
            ? []
            : [
                "getWeather",
                "createDocument",
                "updateDocument",
                "requestSuggestions",
              ],
          providerOptions: isReasoningModel
            ? {
                anthropic: {
                  thinking: { type: "enabled", budgetTokens: 10_000 },
                },
              }
            : undefined,
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({ session, dataStream }),
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        dataStream.merge(result.toUIMessageStream({ sendReasoning: true }));

        if (titlePromise) {
          const title = await titlePromise;
          dataStream.write({ type: "data-chat-title", data: title });
          updateChatTitleById({ chatId: id, title });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        if (isToolApprovalFlow) {
          for (const finishedMsg of finishedMessages) {
            const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
            if (existingMsg) {
              await updateMessage({
                id: finishedMsg.id,
                parts: finishedMsg.parts,
              });
            } else {
              await saveMessages({
                messages: [
                  {
                    id: finishedMsg.id,
                    role: finishedMsg.role,
                    parts: finishedMsg.parts,
                    createdAt: new Date(),
                    attachments: [],
                    chatId: id,
                  },
                ],
              });
            }
          }
        } else if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: () => "Oops, an error occurred!",
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          // ignore redis errors
        }
      },
    });
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatSDKError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatSDKError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
