"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  KNOWLEDGE_BASE_UPDATED_EVENT,
  type KnowledgeBaseItem,
  type KnowledgeBaseItemType,
  loadKnowledgeBase,
  removeKnowledgeBaseItem,
} from "@/lib/knowledge-base";
import { Button } from "./ui/button";

type KnowledgeBaseCollectionProps = {
  type: KnowledgeBaseItemType;
  title: string;
  description: string;
};

function formatTimestamp(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "Saved";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function KnowledgeBaseCollection({
  type,
  title,
  description,
}: KnowledgeBaseCollectionProps) {
  const [items, setItems] = useState<KnowledgeBaseItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const refresh = async () => {
      try {
        const data = await loadKnowledgeBase(type);
        if (!isCancelled) {
          setItems(data);
        }
      } catch (error) {
        if (!isCancelled) {
          setItems([]);
        }
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to load Knowledge Base items."
        );
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    refresh().catch(() => {
      // Errors are handled inside refresh.
    });
    const onKnowledgeUpdated = () => {
      refresh().catch(() => {
        // Errors are handled inside refresh.
      });
    };
    window.addEventListener(KNOWLEDGE_BASE_UPDATED_EVENT, onKnowledgeUpdated);
    return () => {
      isCancelled = true;
      window.removeEventListener(
        KNOWLEDGE_BASE_UPDATED_EVENT,
        onKnowledgeUpdated
      );
    };
  }, [type]);

  const handleDelete = async (itemId: string) => {
    setDeletingItemId(itemId);
    try {
      await removeKnowledgeBaseItem(itemId);
      setItems((prev) => prev.filter((item) => item.id !== itemId));
      toast.success("Removed from Knowledge Base");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to delete Knowledge Base item."
      );
    } finally {
      setDeletingItemId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6">
        <h1 className="font-semibold text-2xl">{title}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{description}</p>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center text-muted-foreground">
          Loading saved {type === "strategy" ? "strategies" : "screeners"}...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center text-muted-foreground">
          No saved {type === "strategy" ? "strategies" : "screeners"} yet.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article className="rounded-lg border bg-card p-4" key={item.id}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-medium text-base">{item.title}</h2>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {item.summary || formatTimestamp(item.createdAt)}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs">
                  {formatTimestamp(item.createdAt)}
                </span>
              </div>

              <pre className="max-h-56 overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
                {JSON.stringify(item.payload, null, 2)}
              </pre>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {item.chatId ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/chat/${item.chatId}`}>Open source chat</Link>
                  </Button>
                ) : null}
                <Button
                  disabled={deletingItemId === item.id}
                  onClick={() => {
                    handleDelete(item.id).catch(() => {
                      // Errors are handled inside handleDelete.
                    });
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {deletingItemId === item.id ? "Removing..." : "Remove"}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
