// backend/src/api/anythingllm.ts
import { Router } from "express";
import { anythingllmRequest } from "../services/anythingllm";
import { readSettings } from "../services/settings";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require("multer");

const router = Router();

// Optional quick probe
router.get("/debug", (_req, res) => res.json({ mounted: true }));

/**
 * PING (proxy -> /api/ping, no /v1) ΓÇö uses built-in fetch (Node 18+)
 */
router.get("/ping", async (_req, res) => {
  try {
    const s = readSettings();
    const baseUrl = (String(s.anythingLLMUrl || "http://localhost:3001").trim()).replace(/\/+$/, "");
    const base = `${baseUrl}/api`;
    const apiKey = String(s.anythingLLMKey || "").trim();
    const r = await fetch(`${base}/ping`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    // Map common upstream statuses cleanly
    if (r.status === 403) return res.status(403).json({ message: "Invalid API Key" });

    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (err: any) {
    return res.status(502).json({ message: "Ping failed: Upstream error" });
  }
});

/**
 * AUTH
 * Proxies: GET http://localhost:3001/api/v1/auth (if available)
 * Fallback: Check if /workspaces endpoint returns valid response
 * Expects: Authorization: Bearer <API KEY> (added by service helper)
 */


router.get("/auth", async (_req, res) => {
  try {
    // Debug: Check what settings we have
    const s = require('../services/settings').readSettings();
    console.log('[AUTH-CHECK] Settings loaded:', { 
      hasUrl: !!s.anythingLLMUrl, 
      hasKey: !!s.anythingLLMKey,
      keyLength: s.anythingLLMKey?.length || 0 
    });
    
    // Try the /auth endpoint first
    const data = await anythingllmRequest<{ authenticated: boolean }>("/auth", "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Auth check failed");
    console.log('[AUTH-CHECK] Error:', msg);
    const isForbidden = /403/.test(msg);
    const isNotConfigured = /NotConfigured/i.test(msg) || /ANYTHINGLLM_API_KEY.*missing/i.test(msg);
    const isNotFound = /404/.test(msg) || /Cannot GET/i.test(msg);
    
    // If /auth endpoint doesn't exist (404), try /workspaces as fallback
    if (isNotFound) {
      try {
        await anythingllmRequest<any>("/workspaces", "GET");
        // If workspaces call succeeds, authentication is valid
        return res.json({ authenticated: true });
      } catch (fallbackErr: any) {
        const fallbackMsg = String(fallbackErr?.message || "Auth check failed");
        const fallbackForbidden = /403/.test(fallbackMsg);
        return res.status(fallbackForbidden ? 403 : 502).json({
          message: fallbackForbidden ? "Invalid API Key" : fallbackMsg,
        });
      }
    }
    
    res.status(isNotConfigured ? 400 : (isForbidden ? 403 : 502)).json({
      message: isNotConfigured ? "Missing API Key in settings" : (isForbidden ? "Invalid API Key" : msg),
    });
  }
});

/**
 * ADMIN: Is Multi-User Mode
 * Proxies: GET /api/v1/admin/is-multi-user-mode
 * Upstream expects: Authorization: Bearer <API KEY> (added by service helper)
 * Example response: { isMultiUser: boolean }
 */
router.get("/admin/is-multi-user-mode", async (_req, res) => {
  try {
    const data = await anythingllmRequest<{ isMultiUser: boolean }>(
      "/admin/is-multi-user-mode",
      "GET"
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Multi-user mode check failed");
    const isForbidden = /403/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});

/**
 * ADMIN: List Users
 * Proxies: GET /api/v1/admin/users
 * Notes:
 *  - 401 => instance not in multi-user mode (pass through as "Unauthorized")
 *  - 403 => invalid API key
 */
router.get("/admin/users", async (_req, res) => {
  try {
    const data = await anythingllmRequest<{ users: { username: string; role: string }[] }>(
      "/admin/users",
      "GET"
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Users fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isUnauthorized = /\b401\b/i.test(msg) || /unauthorized/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isUnauthorized) return res.status(401).send("Unauthorized");

    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Create
 * Proxies: POST /api/v1/workspace/new
 * Body: JSON workspace config (e.g., { name, similarityThreshold, ... })
 */
router.post("/workspace/new", async (req, res) => {
  try {
    const data = await anythingllmRequest<{
      workspace: {
        id: number;
        name: string;
        slug: string;
        createdAt: string;
        openAiTemp: number | null;
        lastUpdatedAt: string;
        openAiHistory: number;
        openAiPrompt: string | null;
      };
      message: string;
    }>("/workspace/new", "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Workspace creation failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });

    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: List
 * Proxies: GET /api/v1/workspaces
 */
router.get("/workspaces", async (_req, res) => {
  try {
    const upstream = await anythingllmRequest<any>("/workspaces", "GET");
    // Normalize to { workspaces: [...] }
    const workspaces = Array.isArray(upstream?.workspaces)
      ? upstream.workspaces
      : Array.isArray(upstream)
      ? upstream
      : [];
    return res.json({ workspaces });
  } catch (err: any) {
    const msg = String(err?.message || "Workspaces fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});

/**
 * WORKSPACES: Get by slug
 * Proxies: GET /api/v1/workspace/:slug
 */
router.get("/workspace/:slug", async (req, res) => {
  const { slug } = req.params;
  try {
    // Upstream may return { workspace: {..., threads?} }
    // or { workspace: [{...}] } or bare {...} and sometimes threads are top-level.
    const upstream = await anythingllmRequest<any>(
      `/workspace/${encodeURIComponent(slug)}`,
      "GET"
    );

    let workspace = upstream?.workspace ?? upstream;
    if (Array.isArray(workspace)) workspace = workspace[0] ?? null;

    if (!workspace) return res.status(404).json({ message: "Workspace not found" });

    // Normalize threads to always be an array and merge any top-level threads
    const merged: any[] = [];
    const pushMany = (arr: any) => {
      if (Array.isArray(arr)) merged.push(...arr);
      else if (arr && typeof arr === 'object') merged.push(...Object.values(arr));
    };
    pushMany(workspace.threads);
    pushMany(upstream?.threads);
    // De-duplicate by slug or id
    const seen = new Set<string>();
    const threads = merged.filter((t) => {
      const key = String(t?.slug ?? t?.id ?? Math.random());
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    workspace.threads = threads;

    return res.json({ workspace });
  } catch (err: any) {
    const msg = String(err?.message || "Workspace fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});

/**
 * WORKSPACES: Threads list (normalized convenience route)
 * Proxies: GET /api/v1/workspace/:slug
 * Returns: { threads: Thread[] }
 */
router.get("/workspace/:slug/threads", async (req, res) => {
  const { slug } = req.params;
  try {
    const upstream = await anythingllmRequest<any>(
      `/workspace/${encodeURIComponent(slug)}`,
      "GET"
    );
    let workspace = upstream?.workspace ?? upstream;
    if (Array.isArray(workspace)) workspace = workspace[0] ?? null;
    if (!workspace) return res.status(404).json({ message: "Workspace not found" });

    const merged: any[] = [];
    const pushMany = (arr: any) => {
      if (Array.isArray(arr)) merged.push(...arr);
      else if (arr && typeof arr === 'object') merged.push(...Object.values(arr));
    };
    pushMany(workspace.threads);
    pushMany(upstream?.threads);
    const seen = new Set<string>();
    const threads = merged.filter((t) => {
      const key = String(t?.slug ?? t?.id ?? Math.random());
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.json({ threads });
  } catch (err: any) {
    const msg = String(err?.message || "Workspace threads fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    return res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});

/**
 * WORKSPACES: Delete by slug
 * Proxies: DELETE /api/v1/workspace/:slug
 */
router.delete("/workspace/:slug", async (req, res) => {
  const { slug } = req.params;
  try {
    const data = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(slug)}`, "DELETE");
    res.json(data ?? { message: "Deleted" });
  } catch (err: any) {
    const msg = String(err?.message || "Workspace delete failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Update by slug
 * Proxies: POST /api/v1/workspace/:slug/update
 * Body: partial settings (only provided keys are updated)
 */
router.post("/workspace/:slug/update", async (req, res) => {
  const { slug } = req.params;
  try {
    const data = await anythingllmRequest<{
      workspace: {
        id: number;
        name: string;
        slug: string;
        createdAt: string;
        openAiTemp: number | null;
        lastUpdatedAt: string;
        openAiHistory: number;
        openAiPrompt: string | null;
        documents: any[];
      };
      message: string | null;
    }>(`/workspace/${encodeURIComponent(slug)}/update`, "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Workspace update failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Chats by slug
 * Proxies: GET /api/v1/workspace/:slug/chats
 * Query (optional): apiSessionId, limit, orderBy (asc|desc)
 */
router.get("/workspace/:slug/chats", async (req, res) => {
  const { slug } = req.params;
  const { apiSessionId, limit, orderBy } = req.query as {
    apiSessionId?: string;
    limit?: string | number;
    orderBy?: string;
  };

  try {
    const q = new URLSearchParams();
    if (apiSessionId) q.set("apiSessionId", String(apiSessionId));
    if (limit) q.set("limit", String(limit));
    if (orderBy) q.set("orderBy", String(orderBy));
    const qs = q.toString() ? `?${q.toString()}` : "";

    const data = await anythingllmRequest<{ history: any[] }>(
      `/workspace/${encodeURIComponent(slug)}/chats${qs}`,
      "GET"
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Workspace chats fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Update Embeddings by slug
 * Proxies: POST /api/v1/workspace/:slug/update-embeddings
 * Body: { adds?: string[]; deletes?: string[] }
 */
router.post("/workspace/:slug/update-embeddings", async (req, res) => {
  const { slug } = req.params;
  try {
    const data = await anythingllmRequest<{
      workspace: {
        id: number;
        name: string;
        slug: string;
        createdAt: string;
        openAiTemp: number | null;
        lastUpdatedAt: string;
        openAiHistory: number;
        openAiPrompt: string | null;
        documents: any[];
      };
      message: string | null;
    }>(`/workspace/${encodeURIComponent(slug)}/update-embeddings`, "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Workspace embeddings update failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Update Document Pin Status
 * Proxies: POST /api/v1/workspace/:slug/update-pin
 * Body: { docPath: string; pinStatus: boolean }
 */
router.post("/workspace/:slug/update-pin", async (req, res) => {
  const { slug } = req.params;
  try {
    const data = await anythingllmRequest<{ message: string }>(
      `/workspace/${encodeURIComponent(slug)}/update-pin`,
      "POST",
      req.body ?? {}
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Workspace pin update failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not\s*found/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    if (isNotFound) return res.status(404).json({ message: "Document not found" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Chat
 * Proxies: POST /api/v1/workspace/:slug/chat
 * Body: { message, mode: "query"|"chat", sessionId?, attachments?, reset? }
 */
router.post("/workspace/:slug/chat", async (req, res) => {
  const { slug } = req.params;
  try {
    const data = await anythingllmRequest<{
      id: string;
      type: "abort" | "textResponse";
      textResponse?: string;
      sources?: Array<{ title: string; chunk: string }>;
      close?: boolean;
      error?: string | null;
    }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Workspace chat failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Create Thread
 * Proxies: POST /api/v1/workspace/:slug/thread/new
 * Body (optional): { userId?: number; name?: string; slug?: string }
 */
router.post("/workspace/:slug/thread/new", async (req, res) => {
  const { slug } = req.params;
  try {
    const data = await anythingllmRequest<{
      thread: { id: number; name: string; slug: string; user_id?: number; workspace_id: number };
      message: string | null;
    }>(`/workspace/${encodeURIComponent(slug)}/thread/new`, "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Workspace thread creation failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Update Thread by slug
 * Proxies: POST /api/v1/workspace/:slug/thread/:threadSlug/update
 * Body: { name: string }
 */
router.post("/workspace/:slug/thread/:threadSlug/update", async (req, res) => {
  const { slug, threadSlug } = req.params;
  try {
    const data = await anythingllmRequest<{
      thread: { id: number; name: string; slug: string; user_id?: number; workspace_id: number };
      message: string | null;
    }>(
      `/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/update`,
      "POST",
      req.body ?? {}
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Workspace thread update failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Delete Thread by slug
 * Proxies: DELETE /api/v1/workspace/:slug/thread/:threadSlug
 */
router.delete("/workspace/:slug/thread/:threadSlug", async (req, res) => {
  const { slug, threadSlug } = req.params;
  try {
    const data = await anythingllmRequest<any>(
      `/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}`,
      "DELETE"
    );
    res.json(data ?? { message: "Thread deleted successfully" });
  } catch (err: any) {
    const msg = String(err?.message || "Workspace thread delete failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Get Thread Chats
 * Proxies: GET /api/v1/workspace/:slug/thread/:threadSlug/chats
 */
router.get("/workspace/:slug/thread/:threadSlug/chats", async (req, res) => {
  const { slug, threadSlug } = req.params;

  try {
    const data = await anythingllmRequest<{
      history: Array<{
        role: "user" | "assistant" | string;
        content?: string;
        sentAt?: number;
        sources?: Array<Record<string, any>>;
      }>;
    }>(
      `/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chats`,
      "GET"
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Thread chats fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });

    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Chat with Thread
 * Proxies: POST /api/v1/workspace/:slug/thread/:threadSlug/chat
 * Body: { message, mode: "query"|"chat", userId?, attachments?, reset? }
 */
router.post("/workspace/:slug/thread/:threadSlug/chat", async (req, res) => {
  const { slug, threadSlug } = req.params;
  try {
    const data = await anythingllmRequest<{
      id: string;
      type: "abort" | "textResponse";
      textResponse?: string;
      sources?: Array<{ title: string; chunk: string }>;
      close?: boolean;
      error?: string | null;
    }>(
      `/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chat`,
      "POST",
      req.body ?? {}
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Thread chat failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * WORKSPACES: Stream Chat with Thread (SSE passthrough)
 * Proxies: POST /api/v1/workspace/:slug/thread/:threadSlug/stream-chat
 * Body: { message, mode: "query"|"chat", userId?, attachments?, reset? }
 */
router.post("/workspace/:slug/thread/:threadSlug/stream-chat", async (req, res) => {
  const { slug, threadSlug } = req.params;

  try {
    // Build upstream URL from configured API root and ensure /api/v1 prefix
    const s = readSettings();
    const apiRoot = (String(s.anythingLLMUrl || "http://localhost:3001").trim()).replace(/\/+$/, "");
    const base = `${apiRoot}/api/v1`;
    const apiKey = String(s.anythingLLMKey || "").trim();

    // Abort upstream if client disconnects
    const controller = new AbortController();
    // Abort upstream if client disconnects
    req.on("close", () => controller.abort());
    const upstream = await fetch(
      `${base}/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/stream-chat`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(req.body ?? {}),
        signal: controller.signal,
      }
    );

    if (upstream.status === 403) {
      return res.status(403).json({ message: "Invalid API Key" });
    }
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return res.status(502).json({
        message: `Stream chat failed: ${upstream.status} ${upstream.statusText}`,
        detail,
      });
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore (flushHeaders exists in Express types depending on version)
    res.flushHeaders?.();

    // Pipe upstream web stream -> Express response
    const reader = upstream.body!.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (_err) {
    res.status(502).json({ message: "Stream chat failed: Upstream error" });
  }
});

/**
 * EMBEDS: List all active embeds
 * Proxies: GET /api/v1/embed
 */
router.get("/embed", async (_req, res) => {
  try {
    const data = await anythingllmRequest<{
      embeds: Array<{
        id: number;
        uuid: string;
        enabled: boolean;
        chat_mode: "query" | "chat" | string;
        createdAt: string;
        workspace: { id: number; name: string };
        chat_count: number;
      }>;
    }>("/embed", "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Embeds fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});

/**
 * EMBEDS: Get chats for a specific embed
 * Proxies: GET /api/v1/embed/:embedUuid/chats
 */
router.get("/embed/:embedUuid/chats", async (req, res) => {
  const { embedUuid } = req.params;
  try {
    const data = await anythingllmRequest<{
      chats: Array<{
        id: number;
        session_id: string;
        prompt: string;
        response: string;
        createdAt: string;
      }>;
    }>(`/embed/${encodeURIComponent(embedUuid)}/chats`, "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Embed chats fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not\s*found/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isNotFound) return res.status(404).send("Embed not found");

    res.status(502).json({ message: msg });
  }
});

/**
 * EMBEDS: Get chats for a specific embed + session
 * Proxies: GET /api/v1/embed/:embedUuid/chats/:sessionUuid
 */
router.get("/embed/:embedUuid/chats/:sessionUuid", async (req, res) => {
  const { embedUuid, sessionUuid } = req.params;
  try {
    const data = await anythingllmRequest<{
      chats: Array<{ id: number; prompt: string; response: string; createdAt: string }>;
    }>(
      `/embed/${encodeURIComponent(embedUuid)}/chats/${encodeURIComponent(sessionUuid)}`,
      "GET"
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Embed session chats fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not\s*found/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isNotFound) return res.status(404).send("Embed or session not found");

    res.status(502).json({ message: msg });
  }
});

/**
 * EMBEDS: Create new embed
 * Proxies: POST /api/v1/embed/new
 * Body: {
 *   workspace_slug: string;
 *   chat_mode?: "chat"|"query";
 *   allowlist_domains?: string[];
 *   allow_model_override?: boolean;
 *   allow_temperature_override?: boolean;
 *   allow_prompt_override?: boolean;
 *   max_chats_per_day?: number;
 *   max_chats_per_session?: number;
 * }
 */
router.post("/embed/new", async (req, res) => {
  try {
    const data = await anythingllmRequest<{
      embed: {
        id: number;
        uuid: string;
        enabled: boolean;
        chat_mode: "chat" | "query" | string;
        allowlist_domains: string[];
        allow_model_override: boolean;
        allow_temperature_override: boolean;
        allow_prompt_override: boolean;
        max_chats_per_day: number;
        max_chats_per_session: number;
        createdAt: string;
        workspace_slug: string;
      };
      error: string | null;
    }>("/embed/new", "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Embed creation failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not\s*found/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    if (isNotFound) return res.status(404).send("Workspace not found");

    res.status(502).json({ message: msg });
  }
});

/**
 * EMBEDS: Update existing embed
 * Proxies: POST /api/v1/embed/:embedUuid
 * Body: partial embed config (enabled, chat_mode, allowlist_domains, overrides, limits, ...)
 */
router.post("/embed/:embedUuid", async (req, res) => {
  const { embedUuid } = req.params;
  try {
    const data = await anythingllmRequest<{ success: boolean; error: string | null }>(
      `/embed/${encodeURIComponent(embedUuid)}`,
      "POST",
      req.body ?? {}
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Embed update failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not\s*found/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isNotFound) return res.status(404).send("Embed not found");

    res.status(502).json({ message: msg });
  }
});

/**
 * EMBEDS: Delete embed
 * Proxies: DELETE /api/v1/embed/:embedUuid
 */
router.delete("/embed/:embedUuid", async (req, res) => {
  const { embedUuid } = req.params;
  try {
    const data = await anythingllmRequest<{ success: boolean; error: string | null }>(
      `/embed/${encodeURIComponent(embedUuid)}`,
      "DELETE"
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Embed delete failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not\s*found/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isNotFound) return res.status(404).send("Embed not found");

    res.status(502).json({ message: msg });
  }
});

/**
 * DOCUMENTS: List all locally stored documents
 * Proxies: GET /api/v1/documents
 */
router.get("/documents", async (_req, res) => {
  try {
    const data = await anythingllmRequest<any>("/documents", "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Documents list failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});

/**
 * DOCUMENTS: Get all documents in a specific folder
 * Proxies: GET /api/v1/documents/folder/:folderName
 */
router.get("/documents/folder/:folderName", async (req, res) => {
  const { folderName } = req.params;
  try {
    const data = await anythingllmRequest<{
      folder: string;
      documents: Array<{
        name: string;
        type: string;
        cached: boolean;
        pinnedWorkspaces: string[];
        watched: boolean;
        [key: string]: any;
      }>;
    }>(`/documents/folder/${encodeURIComponent(folderName)}`, "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Folder documents fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not\s*found/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isNotFound) return res.status(404).json({ message: "Folder not found" });
    res.status(502).json({ message: msg });
  }
});

/**
 * DOCUMENTS: Get single document by AnythingLLM name
 * Proxies: GET /api/v1/document/:docName
 */
router.get("/document/:docName", async (req, res) => {
  const { docName } = req.params;
  try {
    const data = await anythingllmRequest<any>(
      `/document/${encodeURIComponent(docName)}`,
      "GET"
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Document fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not\s*found/i.test(msg);
    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isNotFound) return res.status(404).send("Not Found");
    res.status(502).json({ message: msg });
  }
});

/**
 * DOCUMENTS: Get metadata schema for raw-text uploads
 * Proxies: GET /api/v1/document/metadata-schema
 */
router.get("/document/metadata-schema", async (_req, res) => {
  try {
    const data = await anythingllmRequest<{
      schema: Record<string, string>;
    }>("/document/metadata-schema", "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Metadata schema fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    res.status(502).json({ message: msg });
  }
});

/**
 * SYSTEM: Remove documents permanently
 * Proxies: DELETE /api/v1/system/remove-documents
 * Body: { names: string[] }
 */
router.delete("/system/remove-documents", async (req, res) => {
  try {
    const body = req.body ?? {};
    const data = await anythingllmRequest<{ success: boolean; message?: string }>(
      "/system/remove-documents",
      "DELETE",
      body
    );
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Remove documents failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});


/**
 * DOCUMENTS: Upload and optionally embed into workspaces
 * Proxies: POST /api/v1/document/upload
 * multipart/form-data fields:
 *   - file: binary
 *   - addToWorkspaces: comma-separated slugs
 */
router.post("/document/upload", (req, res) => {
  const upload = multer({ storage: multer.memoryStorage() });
  upload.single("file")(req, res, async (err: any) => {
    if (err) return res.status(400).json({ message: String(err?.message || err) });
    try {
      const f = (req as any).file as undefined | { originalname: string; buffer: Buffer; mimetype?: string };
      const addToWorkspaces = String((req.body?.addToWorkspaces ?? "")).trim();
      if (!f || !f.buffer) return res.status(400).json({ message: "Missing file" });

      // Build FormData for upstream
      const fd = new FormData();
      const type = f.mimetype || "application/octet-stream";
      const uint = new Uint8Array(f.buffer);
      // @ts-ignore File is available in Node 18+
      const fileObj = new File([uint], f.originalname, { type });
      fd.append("file", fileObj);
      if (addToWorkspaces) fd.append("addToWorkspaces", addToWorkspaces);

      const data = await anythingllmRequest<any>("/document/upload", "POST", fd);
      return res.json(data);
    } catch (e: any) {
      const msg = String(e?.message || e);
      const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
      return res.status(isForbidden ? 403 : 502).json({
        message: isForbidden ? "Invalid API Key" : msg,
      });
    }
  });
});

/**
 * DOCUMENTS: Upload to specific folder and optionally embed into workspaces
 * Proxies: POST /api/v1/document/upload/:folderName
 * Path param:
 *   - folderName: Target folder path (folder will be created if it doesn't exist)
 * multipart/form-data fields:
 *   - file: binary
 *   - addToWorkspaces: comma-separated slugs
 */
router.post("/document/upload/:folderName", (req, res) => {
  const { folderName } = req.params;
  const upload = multer({ storage: multer.memoryStorage() });
  upload.single("file")(req, res, async (err: any) => {
    if (err) return res.status(400).json({ message: String(err?.message || err) });
    try {
      const f = (req as any).file as undefined | { originalname: string; buffer: Buffer; mimetype?: string };
      const addToWorkspaces = String((req.body?.addToWorkspaces ?? "")).trim();
      if (!f || !f.buffer) return res.status(400).json({ message: "Missing file" });

      // Build FormData for upstream
      const fd = new FormData();
      const type = f.mimetype || "application/octet-stream";
      const uint = new Uint8Array(f.buffer);
      // @ts-ignore File is available in Node 18+
      const fileObj = new File([uint], f.originalname, { type });
      fd.append("file", fileObj);
      if (addToWorkspaces) fd.append("addToWorkspaces", addToWorkspaces);

      const data = await anythingllmRequest<any>(
        `/document/upload/${encodeURIComponent(folderName)}`,
        "POST",
        fd
      );
      return res.json(data);
    } catch (e: any) {
      const msg = String(e?.message || e);
      const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
      return res.status(isForbidden ? 403 : 502).json({
        message: isForbidden ? "Invalid API Key" : msg,
      });
    }
  });
});

/**
 * DOCUMENTS: Upload link to be scraped and optionally embed into workspaces
 * Proxies: POST /api/v1/document/upload-link
 * Body: { link: string; addToWorkspaces?: string; scraperHeaders?: Record<string, string> }
 */
router.post("/document/upload-link", async (req, res) => {
  try {
    const data = await anythingllmRequest<{
      success: boolean;
      error: string | null;
      documents?: Array<{
        id: string;
        url: string;
        title: string;
        docAuthor: string;
        description: string;
        docSource: string;
        chunkSource: string;
        published: string;
        wordCount: number;
        pageContent: string;
        token_count_estimate: number;
        location: string;
      }>;
    }>("/document/upload-link", "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Link upload failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * DOCUMENTS: Upload raw text content as a document
 * Proxies: POST /api/v1/document/raw-text
 * Body: { textContent: string; addToWorkspaces?: string; metadata: { title: string; [key: string]: any } }
 */
router.post("/document/raw-text", async (req, res) => {
  try {
    const data = await anythingllmRequest<{
      success: boolean;
      error: string | null;
      documents?: Array<{
        id: string;
        url: string;
        title: string;
        docAuthor: string;
        description: string;
        docSource: string;
        chunkSource: string;
        published: string;
        wordCount: number;
        pageContent: string;
        token_count_estimate: number;
        location: string;
      }>;
    }>("/document/raw-text", "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Raw text upload failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);
    const isUnprocessable = /\b422\b/i.test(msg) || /unprocessable/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    if (isUnprocessable) return res.status(422).json({ message: "Unprocessable Entity" });
    res.status(502).json({ message: msg });
  }
});

/**
 * DOCUMENTS: Create a new folder in documents storage
 * Proxies: POST /api/v1/document/create-folder
 * Body: { name: string }
 */
router.post("/document/create-folder", async (req, res) => {
  try {
    const data = await anythingllmRequest<{
      success: boolean;
      message: string | null;
    }>("/document/create-folder", "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Folder creation failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * DOCUMENTS: Remove a folder and all its contents from documents storage
 * Proxies: DELETE /api/v1/document/remove-folder
 * Body: { name: string }
 */
router.delete("/document/remove-folder", async (req, res) => {
  try {
    const data = await anythingllmRequest<{
      success: boolean;
      message: string;
    }>("/document/remove-folder", "DELETE", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Folder removal failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});

/**
 * DOCUMENTS: Move files within documents storage
 * Proxies: POST /api/v1/document/move-files
 * Body: { files: Array<{ from: string; to: string }> }
 */
router.post("/document/move-files", async (req, res) => {
  try {
    const data = await anythingllmRequest<{
      success: boolean;
      message: string | null;
    }>("/document/move-files", "POST", req.body ?? {});
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "File move failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isBadReq = /\b400\b/i.test(msg) || /bad\s*request/i.test(msg);

    if (isForbidden) return res.status(403).json({ message: "Invalid API Key" });
    if (isBadReq) return res.status(400).json({ message: "Bad Request" });
    res.status(502).json({ message: msg });
  }
});


export = router;


