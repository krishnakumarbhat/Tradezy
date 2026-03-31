import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { ChatSDKError } from "@/lib/errors";

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

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { id } = await context.params;
  if (!id || id.trim().length === 0) {
    return new ChatSDKError("bad_request:api", "Missing item id.").toResponse();
  }

  try {
    const rustApiUrl = getRustApiUrl();
    const tenantId = String(process.env.RUST_TENANT_ID ?? "default");
    const params = new URLSearchParams({
      tenant_id: tenantId,
      user_id: session.user.id,
    });

    const response = await fetch(
      `${rustApiUrl}/api/knowledge-base/${encodeURIComponent(id)}?${params}`,
      {
        method: "DELETE",
        headers: {
          "X-Source": "nextjs",
        },
      }
    );

    const payload = await parseRustResponse(response);
    if (!response.ok || !payload.success) {
      return new ChatSDKError(
        "bad_request:api",
        payload.error ?? "Failed to delete knowledge-base item."
      ).toResponse();
    }

    return Response.json(payload.data ?? { deleted: true });
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
