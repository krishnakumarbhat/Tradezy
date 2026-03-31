import type { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { ChatSDKError } from "@/lib/errors";

const createKnowledgeBaseSchema = z.object({
  type: z.enum(["strategy", "screener"]),
  title: z.string().trim().min(1),
  summary: z.string().trim().optional(),
  chatId: z.string().trim().optional(),
  messageId: z.string().trim().optional(),
  payload: z.unknown(),
});

type RustApiResponse = {
  success: boolean;
  data?: unknown;
  error?: string | null;
};

function getRustApiUrl() {
  const rustApiUrl = process.env.RUST_API_URL;
  if (!rustApiUrl) {
    throw new ChatSDKError("offline:chat", "RUST_API_URL is not configured.");
  }
  return rustApiUrl.replace(/\/$/, "");
}

function getSessionIds() {
  const tenantId = String(process.env.RUST_TENANT_ID ?? "default");
  return { tenantId };
}

async function parseRustResponse(response: Response): Promise<RustApiResponse> {
  const text = await response.text();
  try {
    return JSON.parse(text) as RustApiResponse;
  } catch {
    return {
      success: false,
      error: text || "Rust service returned an invalid response.",
    };
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const type = request.nextUrl.searchParams.get("type");
  if (type && type !== "strategy" && type !== "screener") {
    return new ChatSDKError(
      "bad_request:api",
      "Invalid type. Use strategy or screener."
    ).toResponse();
  }

  try {
    const rustApiUrl = getRustApiUrl();
    const { tenantId } = getSessionIds();
    const params = new URLSearchParams({
      tenant_id: tenantId,
      user_id: session.user.id,
    });
    if (type) {
      params.set("item_type", type);
    }

    const response = await fetch(`${rustApiUrl}/api/knowledge-base?${params}`, {
      method: "GET",
      headers: {
        "X-Source": "nextjs",
      },
      cache: "no-store",
    });

    const payload = await parseRustResponse(response);
    if (!response.ok || !payload.success) {
      return new ChatSDKError(
        "bad_request:api",
        payload.error ?? "Failed to load knowledge base."
      ).toResponse();
    }

    return Response.json(payload.data ?? { items: [] });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    return new ChatSDKError(
      "offline:chat",
      "Could not reach knowledge-base service."
    ).toResponse();
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  let body: z.infer<typeof createKnowledgeBaseSchema>;
  try {
    body = createKnowledgeBaseSchema.parse(await request.json());
  } catch {
    return new ChatSDKError("bad_request:api", "Invalid payload.").toResponse();
  }

  try {
    const rustApiUrl = getRustApiUrl();
    const { tenantId } = getSessionIds();

    const response = await fetch(`${rustApiUrl}/api/knowledge-base`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Source": "nextjs",
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        user_id: session.user.id,
        chat_id: body.chatId,
        message_id: body.messageId,
        type: body.type,
        title: body.title,
        summary: body.summary,
        payload: body.payload,
      }),
    });

    const payload = await parseRustResponse(response);
    if (!response.ok || !payload.success) {
      return new ChatSDKError(
        "bad_request:api",
        payload.error ?? "Failed to save knowledge-base item."
      ).toResponse();
    }

    return Response.json(payload.data ?? {});
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    return new ChatSDKError(
      "offline:chat",
      "Could not reach knowledge-base service."
    ).toResponse();
  }
}
