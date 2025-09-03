import { APP_CONFIG } from "../utils/config";

const ANYTHINGLLM_API_URL = APP_CONFIG.anythingLLMUrl.replace(/\/+$/, "");
const ANYTHINGLLM_API_KEY = APP_CONFIG.anythingLLMKey;

if (!ANYTHINGLLM_API_URL) throw new Error("ANYTHINGLLM_API_URL is not set in .env");
if (!ANYTHINGLLM_API_KEY) throw new Error("ANYTHINGLLM_API_KEY is not set in .env");

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function anythingllmRequest<T>(
  path: string,
  method: HttpMethod,
  body?: any,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
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
