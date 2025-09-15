import { readSettings } from "./settings";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function resolveAnythingLLM() {
  const s = readSettings();
  const rawUrl = (s.anythingLLMUrl || 'http://localhost:3001').trim();
  const baseUrl = rawUrl ? rawUrl.replace(/\/+$/, "") : "";
  const apiKey = (s.anythingLLMKey || '').trim();
  return { baseUrl, apiKey };
}

export async function anythingllmRequest<T>(
  path: string,
  method: HttpMethod,
  body?: any,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const { baseUrl, apiKey } = resolveAnythingLLM();
  if (!apiKey) {
    throw new Error('NotConfigured: ANYTHINGLLM_API_KEY missing in settings');
  }
  const url = `${baseUrl}/api/v1${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
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


