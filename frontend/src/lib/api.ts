export async function jget<T = any>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function jpost<T = any>(url: string, body: any): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function jdel<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { method: "DELETE" });
  if (!r.ok) throw new Error(String(r.status));
  try { return await r.json(); } catch { return {} as any; }
}

// AnythingLLM API wrappers
export const A = {
  workspaces: () => jget<any>(`/api/anythingllm/workspaces`),
  workspace: (slug: string) => jget<any>(`/api/anythingllm/workspace/${encodeURIComponent(slug)}`),
  workspaceThreads: (slug: string) => jget<any>(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/threads`),
  createWorkspace: (name: string) => jpost(`/api/anythingllm/workspace/new`, { name }),
  updateWorkspace: (slug: string, data: any) => jpost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/update`, data),
  deleteWorkspace: (slug: string) => jdel(`/api/anythingllm/workspace/${encodeURIComponent(slug)}`),

  createThread: (slug: string, name: string) => jpost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/new`, { name }),
  updateThread: (slug: string, threadSlug: string, name: string) => jpost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/update`, { name }),
  deleteThread: (slug: string, threadSlug: string) => jdel(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}`),

  workspaceChats: (slug: string, limit = 50, orderBy: "asc" | "desc" = "desc") => jget<any>(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/chats?limit=${limit}&orderBy=${orderBy}`),
  threadChats: (slug: string, threadSlug: string) => jget<any>(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chats`),
  chatWorkspace: (slug: string, body: any) => jpost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/chat`, body),
  chatThread: (slug: string, threadSlug: string, body: any) => jpost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chat`, body),
  streamThread: (slug: string, threadSlug: string, body: any, signal?: AbortSignal) => fetch(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/stream-chat`, { method: 'POST', headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }),
  // Gen cards persistence
  genCardsByWorkspace: (slug: string) => jget<{ cards: any[] }>(`/api/generate/cards/by-workspace/${encodeURIComponent(slug)}`),
  upsertGenCard: (card: { id: string; workspaceSlug?: string; customerId?: number; side?: 'user'|'assistant'; template?: string; jobId: string; jobStatus?: string; filename?: string; aiContext?: string; timestamp?: number }) => jpost(`/api/generate/cards`, card),
  deleteGenCardsByWorkspace: (slug: string) => jdel(`/api/generate/cards/by-workspace/${encodeURIComponent(slug)}`),
  deleteGenCardsByCustomer: (id: number) => jdel(`/api/generate/cards/by-customer/${encodeURIComponent(String(id))}`),
  deleteGenCardsByJob: (jobId: string) => jdel(`/api/generate/cards/by-job/${encodeURIComponent(jobId)}`),
};
