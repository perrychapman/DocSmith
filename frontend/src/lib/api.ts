// Helper to get the base URL for API calls
function getBaseUrl(): string {
  const isElectron = typeof window !== 'undefined' && (
    navigator.userAgent.includes('Electron') || 
    (window as any).electronAPI || 
    window.location.protocol === 'file:'
  );
  const isProd = import.meta.env.MODE === 'production';
  const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
  
  // In Electron/desktop contexts, point directly at the backend server
  if (isElectron || isFileProtocol) {
    const configuredPort = Number(import.meta.env.VITE_BACKEND_PORT) || Number(import.meta.env.VITE_ELECTRON_BACKEND_PORT);
    const defaultPort = import.meta.env.DEV ? 4000 : 3000;
    const port = configuredPort || defaultPort;
    const host = import.meta.env.VITE_BACKEND_HOST || 'localhost';
    return `http://${host}:${port}`;
  }

  // In web development, use empty string (relative URLs)
  return '';
}

// Helper function for direct fetch calls with base URL
export function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const baseUrl = getBaseUrl();
  return fetch(baseUrl + url, options);
}

// Helper function for EventSource with base URL
export function apiEventSource(url: string): EventSource {
  const baseUrl = getBaseUrl();
  return new EventSource(baseUrl + url);
}

export async function jget<T = any>(url: string): Promise<T> {
  const baseUrl = getBaseUrl();
  const r = await fetch(baseUrl + url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function jpost<T = any>(url: string, body: any): Promise<T> {
  const baseUrl = getBaseUrl();
  const r = await fetch(baseUrl + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function jdel<T = any>(url: string): Promise<T> {
  const baseUrl = getBaseUrl();
  const r = await fetch(baseUrl + url, { method: "DELETE" });
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

  workspaceChats: (slug: string, limit = 100, orderBy: "asc" | "desc" = "desc", apiSessionId?: string, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (apiSessionId) params.set('sessionId', apiSessionId); // Use sessionId for local endpoint
    params.set('onlyVisible', 'true'); // Only get visible messages
    return jget<any>(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/chats/local?${params.toString()}`);
  },
  threadChats: (slug: string, threadSlug: string, limit = 100, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return jget<any>(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chats?${params.toString()}`);
  },
  chatWorkspace: (slug: string, body: any) => jpost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/chat`, body),
  chatThread: (slug: string, threadSlug: string, body: any) => jpost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chat`, body),
  streamWorkspace: (slug: string, body: any, signal?: AbortSignal) => {
    const baseUrl = getBaseUrl();
    return fetch(baseUrl + `/api/anythingllm/workspace/${encodeURIComponent(slug)}/stream-chat`, { 
      method: 'POST', 
      headers: { 
        'Accept': 'text/event-stream', 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal 
    });
  },
  streamThread: (slug: string, threadSlug: string, body: any, signal?: AbortSignal) => {
    const baseUrl = getBaseUrl();
    return fetch(baseUrl + `/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/stream-chat`, { 
      method: 'POST', 
      headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body), 
      signal 
    });
  },
  // Gen cards persistence
  genCardsByWorkspace: (slug: string) => jget<{ cards: any[] }>(`/api/generate/cards/by-workspace/${encodeURIComponent(slug)}`),
  upsertGenCard: (card: { id: string; workspaceSlug?: string; customerId?: number; side?: 'user'|'assistant'; template?: string; jobId: string; jobStatus?: string; filename?: string; aiContext?: string; timestamp?: number }) => jpost(`/api/generate/cards`, card),
  deleteGenCardsByWorkspace: (slug: string) => jdel(`/api/generate/cards/by-workspace/${encodeURIComponent(slug)}`),
  deleteGenCardsByCustomer: (id: number) => jdel(`/api/generate/cards/by-customer/${encodeURIComponent(String(id))}`),
  deleteGenCardsByJob: (jobId: string) => jdel(`/api/generate/cards/by-job/${encodeURIComponent(jobId)}`),
};

// Template Matching Jobs API
export const TemplateMatching = {
  // Start a new matching job
  startJob: (options: {
    templateSlugs?: string[]
    customerIds?: number[]
    forceRecalculate?: boolean
    createdBy?: string
  }) => jpost<{ success: boolean; jobId: string; message: string }>(`/api/template-matching/jobs`, options),
  
  // Get job status
  getJob: (jobId: string) => jget<{
    success: boolean
    job: {
      id: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
      templateSlugs?: string[]
      customerIds?: number[]
      forceRecalculate?: boolean
      totalDocuments: number
      processedDocuments: number
      matchedDocuments: number
      skippedDocuments: number
      startedAt?: string
      completedAt?: string
      error?: string
      createdBy?: string
    }
  }>(`/api/template-matching/jobs/${encodeURIComponent(jobId)}`),
  
  // List all jobs
  listJobs: () => jget<{
    success: boolean
    jobs: Array<{
      id: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
      totalDocuments: number
      processedDocuments: number
      matchedDocuments: number
      skippedDocuments: number
      startedAt?: string
      completedAt?: string
    }>
  }>(`/api/template-matching/jobs`),
  
  // Cancel a job
  cancelJob: (jobId: string) => jdel<{ success: boolean; message: string }>(`/api/template-matching/jobs/${encodeURIComponent(jobId)}`),
  
  // Clear all jobs
  clearAllJobs: () => jdel<{ success: boolean; message: string; count: number }>(`/api/template-matching/jobs`),
  
  // Convenience: Match specific template
  matchTemplate: (templateSlug: string, createdBy?: string) => jpost<{ success: boolean; jobId: string; message: string }>(
    `/api/template-matching/match-template`,
    { templateSlug, createdBy }
  ),
  
  // Convenience: Recalculate all
  recalculateAll: (createdBy?: string) => jpost<{ success: boolean; jobId: string; message: string; warning: string }>(
    `/api/template-matching/recalculate-all`,
    { createdBy }
  ),
};

