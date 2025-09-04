import { APP_CONFIG } from "../utils/config";

const RAW_URL = (APP_CONFIG.anythingLLMUrl || "").trim();
const ANYTHINGLLM_API_URL = RAW_URL ? RAW_URL.replace(/\/+$/, "") : "";
const ANYTHINGLLM_API_KEY = (APP_CONFIG.anythingLLMKey || "").trim();

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function anythingllmRequest<T>(
  path: string,
  method: HttpMethod,
  body?: any,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  if (!ANYTHINGLLM_API_URL || !ANYTHINGLLM_API_KEY) {
    throw new Error(
      `AnythingLLM not configured: missing ${!ANYTHINGLLM_API_URL ? "ANYTHINGLLM_API_URL" : ""}${!ANYTHINGLLM_API_URL && !ANYTHINGLLM_API_KEY ? " and " : ""}${!ANYTHINGLLM_API_KEY ? "ANYTHINGLLM_API_KEY" : ""}`
    );
  }
  // Every call goes through /api/v1
  const url = `${ANYTHINGLLM_API_URL}/api/v1${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${ANYTHINGLLM_API_KEY}`,
    ...extraHeaders,
  };

  let requestBody: any;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  } else {
    requestBody = body;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: requestBody,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AnythingLLM ${method} ${path} failed: ${res.status} ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("application/json")
    ? ((await res.json()) as T)
    : (undefined as unknown as T);
}
