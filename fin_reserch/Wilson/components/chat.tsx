"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { ChatHeader } from "@/components/chat-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useArtifactSelector } from "@/hooks/use-artifact";
import { useAutoResume } from "@/hooks/use-auto-resume";
import { useChatVisibility } from "@/hooks/use-chat-visibility";
import type { Vote } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { Attachment, ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";
import { getHumanInLoopFromMessage } from "@/lib/human-in-loop";
import { Artifact } from "./artifact";
import { ClarifyingQuestionExtension } from "./clarifying-question-extension";
import { useDataStream } from "./data-stream-provider";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";
import { getChatHistoryPaginationKey } from "./sidebar-history";
import { toast } from "./toast";
import type { VisibilityType } from "./visibility-selector";

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      // When user navigates back/forward, refresh to sync with URL
      router.refresh();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [router]);
  const { setDataStream } = useDataStream();

  const [input, setInput] = useState<string>("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const [currentModelId, setCurrentModelId] = useState(initialChatModel);
  const currentModelIdRef = useRef(currentModelId);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    generateId: generateUUID,
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      const shouldContinue =
        lastMessage?.parts?.some(
          (part) =>
            "state" in part &&
            part.state === "approval-responded" &&
            "approval" in part &&
            (part.approval as { approved?: boolean })?.approved === true
        ) ?? false;
      return shouldContinue;
    },
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const isToolApprovalContinuation =
          lastMessage?.role !== "user" ||
          request.messages.some((msg) =>
            msg.parts?.some((part) => {
              const state = (part as { state?: string }).state;
              return (
                state === "approval-responded" || state === "output-denied"
              );
            })
          );

        return {
          body: {
            id: request.id,
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        if (
          error.message?.includes("AI Gateway requires a valid credit card")
        ) {
          setShowCreditCardAlert(true);
        } else {
          toast({
            type: "error",
            description: error.message,
          });
        }
      }
    },
  });

  // Keep context across reload: when user is on new-chat (/) and has completed at least one
  // exchange (user + agent) and the response is done, navigate to /chat/[id]. On refresh they
  // then load the same conversation and the backend has full history for that chat_id.
  const hasNavigatedToChatRef = useRef(false);
  useEffect(() => {
    if (
      pathname !== "/" ||
      hasNavigatedToChatRef.current ||
      messages.length < 2 ||
      status === "streaming"
    ) {
      return;
    }
    hasNavigatedToChatRef.current = true;
    router.replace(`/chat/${id}`);
  }, [pathname, id, messages.length, status, router]);

  const searchParams = useSearchParams();
  const query = searchParams.get("query");

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, "", `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Vote[]>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher
  );

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  const lastMessage = messages.at(-1);
  const pendingClarification =
    lastMessage && lastMessage.role === "assistant"
      ? getHumanInLoopFromMessage(lastMessage)
      : null;
  const prefersReducedMotion = useReducedMotion();

  const prevChatIdRef = useRef(id);
  useEffect(() => {
    if (prevChatIdRef.current !== id) {
      try {
        sessionStorage.removeItem(`clarifying-${prevChatIdRef.current}`);
      } catch {
        // ignore
      }
      prevChatIdRef.current = id;
    }
  }, [id]);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  // Sync messages added externally (e.g. via Rust API from Postman) when viewing this chat.
  useEffect(() => {
    if (!id) {
      return;
    }

    const syncMessages = async () => {
      try {
        const res = await fetch(`/api/chat/${id}/messages`);
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as ChatMessage[];
        setMessages((current) => {
          if (data.length > current.length) {
            return data;
          }
          return current;
        });
      } catch {
        // Ignore; initialMessages from server are still correct.
      }
    };

    syncMessages();
  }, [id, setMessages]);

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          selectedVisibilityType={initialVisibilityType}
        />

        <Messages
          addToolApprovalResponse={addToolApprovalResponse}
          chatId={id}
          isArtifactVisible={isArtifactVisible}
          isReadonly={isReadonly}
          messages={messages}
          regenerate={regenerate}
          selectedModelId={initialChatModel}
          sendMessage={sendMessage}
          setMessages={setMessages}
          status={status}
          votes={votes}
        />

        <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl flex-col gap-0 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            <AnimatePresence initial={false} mode="wait">
              {pendingClarification ? (
                <motion.div
                  key="clarifying"
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full"
                  exit={{
                    opacity: 0,
                    y: prefersReducedMotion ? 0 : -20,
                  }}
                  initial={{
                    opacity: 0,
                    y: prefersReducedMotion ? 0 : 24,
                  }}
                  transition={{
                    duration: prefersReducedMotion ? 0 : 0.45,
                    ease: [0.32, 0.72, 0, 1],
                  }}
                >
                  <ClarifyingQuestionExtension
                    chatId={id}
                    data={pendingClarification}
                    onEscape={() => {
                      sendMessage({
                        role: "user",
                        parts: [{ type: "text", text: "proceed without" }],
                      });
                    }}
                    onSkip={() => {
                      sendMessage({
                        role: "user",
                        parts: [{ type: "text", text: "proceed without" }],
                      });
                    }}
                    onSubmit={(text) => {
                      const lastUserMessage = [...messages]
                        .reverse()
                        .find((m) => m.role === "user");
                      const previousText =
                        lastUserMessage?.parts
                          ?.filter(
                            (p): p is { type: "text"; text: string } =>
                              p.type === "text" && "text" in p
                          )
                          .map((p) => p.text)
                          .join("\n")
                          .trim() ?? "";
                      const combined =
                        previousText.length > 0
                          ? `${previousText}\n\n${text}`
                          : text;
                      sendMessage({
                        role: "user",
                        parts: [{ type: "text", text: combined }],
                      });
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="input"
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full"
                  exit={{
                    opacity: 0,
                    y: prefersReducedMotion ? 0 : 20,
                  }}
                  initial={{
                    opacity: 0,
                    y: prefersReducedMotion ? 0 : 24,
                  }}
                  transition={{
                    duration: prefersReducedMotion ? 0 : 0.45,
                    ease: [0.32, 0.72, 0, 1],
                  }}
                >
                  <MultimodalInput
                    attachments={attachments}
                    chatId={id}
                    input={input}
                    messages={messages}
                    onModelChange={setCurrentModelId}
                    selectedModelId={currentModelId}
                    selectedVisibilityType={visibilityType}
                    sendMessage={sendMessage}
                    setAttachments={setAttachments}
                    setInput={setInput}
                    setMessages={setMessages}
                    status={status}
                    stop={stop}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>

      <Artifact
        addToolApprovalResponse={addToolApprovalResponse}
        attachments={attachments}
        chatId={id}
        input={input}
        isReadonly={isReadonly}
        messages={messages}
        regenerate={regenerate}
        selectedModelId={currentModelId}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        status={status}
        stop={stop}
        votes={votes}
      />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open(
                  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                  "_blank"
                );
                window.location.href = "/";
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
