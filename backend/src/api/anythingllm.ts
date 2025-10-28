// backend/src/api/anythingllm.ts
import { Router } from "express";
import { anythingllmRequest } from "../services/anythingllm";
import { readSettings } from "../services/settings";
import { 
  getCustomerFromWorkspace, 
  buildSailPointSystemPrompt, 
  extractSailPointQueries,
  executeSailPointQuery,
  formatQueryResults
} from "../services/sailpointChatIntegration";
import { 
  analyzeAndPlanQuery,
  executeQueryPlan,
  executeWithRefinement,
  aggregateForSynthesis
} from "../services/sailpointQueryOrchestrator";
import { storeChatMessage, generateConversationId, getChatMessages } from "../services/chatMessages";
import { logInfo, logError } from "../utils/logger";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require("multer");

const router = Router();

// Optional quick probe
router.get("/debug", (_req, res) => res.json({ mounted: true }));

/**
 * SYSTEM: Get all system settings and configuration
 * Proxies: GET /api/v1/system
 * Returns comprehensive system info including LLM provider, embedding engine, vector DB, etc.
 */
router.get("/system", async (_req, res) => {
  try {
    const data = await anythingllmRequest<{
      settings: Record<string, any>
    }>("/system", "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "System info fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});

/**
 * SYSTEM: Get total vector count across all workspaces
 * Proxies: GET /api/v1/system/vector-count
 * Returns total number of embedded vectors in the system
 */
router.get("/system/vector-count", async (_req, res) => {
  try {
    const data = await anythingllmRequest<{
      vectorCount: number
    }>("/system/vector-count", "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "Vector count fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
  }
});

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
 * DOCUMENT: Get accepted file types for upload validation
 * Proxies: GET /api/v1/document/accepted-file-types
 * Returns list of supported MIME types and extensions
 */
router.get("/document/accepted-file-types", async (_req, res) => {
  try {
    const data = await anythingllmRequest<{
      types: Record<string, string[]>
    }>("/document/accepted-file-types", "GET");
    res.json(data);
  } catch (err: any) {
    const msg = String(err?.message || "File types fetch failed");
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      message: isForbidden ? "Invalid API Key" : msg,
    });
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
 * Query (optional): apiSessionId, limit, orderBy (asc|desc), offset
 */
router.get("/workspace/:slug/chats", async (req, res) => {
  const { slug } = req.params;
  const { apiSessionId, limit, orderBy, offset } = req.query as {
    apiSessionId?: string;
    limit?: string | number;
    orderBy?: string;
    offset?: string | number;
  };

  try {
    const q = new URLSearchParams();
    if (apiSessionId) q.set("apiSessionId", String(apiSessionId));
    if (limit) q.set("limit", String(limit));
    if (orderBy) q.set("orderBy", String(orderBy));
    if (offset) q.set("offset", String(offset));
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
 * WORKSPACES: Get chats from local database
 * GET /api/anythingllm/workspace/:slug/chats/local
 * Query (optional): sessionId, limit, offset, onlyVisible
 * Returns chat messages stored in our local DB with better control over visibility
 */
router.get("/workspace/:slug/chats/local", async (req, res) => {
  const { slug } = req.params;
  const { sessionId, limit, offset, onlyVisible } = req.query as {
    sessionId?: string;
    limit?: string | number;
    offset?: string | number;
    onlyVisible?: string;
  };

  try {
    const { getChatMessages } = await import("../services/chatMessages");
    
    const messages = await getChatMessages(slug, {
      sessionId: sessionId || 'user-interactive',
      limit: limit ? Number(limit) : 100,
      offset: offset ? Number(offset) : 0,
      onlyVisible: onlyVisible !== 'false' // Default to true
    });
    
    // Format to match AnythingLLM's response structure
    const history = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
      sentAt: msg.sentAt,
      id: msg.id,
      conversationId: msg.conversationId,
      messageIndex: msg.messageIndex,
      ...(msg.sailpointContext ? { sailpointMetadata: JSON.parse(msg.sailpointContext) } : {})
    }));
    
    res.json({ history });
  } catch (err: any) {
    logError('[LOCAL_CHATS] Failed to fetch local chat messages:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch chat messages' });
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
 * 
 * ENHANCED: Integrates SailPoint function calling for customer workspaces
 */
router.post("/workspace/:slug/chat", async (req, res) => {
  const { slug } = req.params;
  const { message, mode, sessionId, useSailPoint, customerId, customerName } = req.body || {};
  
  try {
    // Only use SailPoint orchestration if explicitly requested via @sailpoint prefix
    const sailpointContext = useSailPoint ? await getCustomerFromWorkspace(slug) : null;
    
    if (sailpointContext && useSailPoint && mode !== 'query') {
      logInfo(`[SAILPOINT_CHAT] SailPoint query requested for workspace: ${slug} (Customer: ${sailpointContext.customerName})`);
      
      // Get recent conversation history for context (last 3 messages to avoid token limits)
      const recentMessages = await getChatMessages(slug, {
        sessionId: 'user-interactive',
        onlyVisible: true,
        limit: 3,
        orderBy: 'desc'
      });
      
      // Build COMPACT conversation context (truncate long responses)
      const conversationContext = recentMessages.reverse().map((msg: any) => {
        const content = msg.content.length > 500 
          ? msg.content.substring(0, 500) + '...[truncated]'
          : msg.content;
        return `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}`;
      }).join('\n');
      
      // Simple approach: Add system prompt, get response with queries, execute queries, 
      // then send FINAL message through normal chat flow
      const systemPrompt = buildSailPointSystemPrompt();
      const enhancedMessage = conversationContext 
        ? `${systemPrompt}\n\nRecent Context (last ${recentMessages.length} messages):\n${conversationContext}\n\nCurrent User Question: ${message}`
        : `${systemPrompt}\n\nUser Question: ${message}`;
      
      // Get LLM response with chat mode but using a system sessionId so it's hidden from user
      logInfo(`[SAILPOINT_CHAT] Querying LLM with SailPoint context (with ${recentMessages.length} messages of compact history)`);
      const llmResponse = await anythingllmRequest<{
        id: string;
        type: "abort" | "textResponse";
        textResponse?: string;
        sources?: Array<{ title: string; chunk: string }>;
        close?: boolean;
        error?: string | null;
      }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", {
        message: enhancedMessage,
        mode: 'chat',
        sessionId: 'system-sailpoint-internal' // Hidden from user chat history
      });
      
      const llmText = llmResponse.textResponse || '';
      
      // Extract SailPoint queries
      const queries = extractSailPointQueries(llmText);
      
      if (queries.length === 0) {
        // No SailPoint queries - just pass through to normal chat
        logInfo(`[SAILPOINT_CHAT] No SailPoint queries detected, using normal chat flow`);
        // Let normal flow handle it below (fall through)
      } else {
        // Execute SailPoint queries with auto-correction and retry
        logInfo(`[SAILPOINT_CHAT] Executing ${queries.length} SailPoint ${queries.length === 1 ? 'query' : 'queries'}`);
        
        let results = await Promise.all(
          queries.map(async (query) => {
            try {
              logInfo(`[SAILPOINT_CHAT] Executing: ${query.action}`);
              // executeSailPointQuery has built-in filter auto-correction
              return await executeSailPointQuery(sailpointContext, query);
            } catch (error: any) {
              logError('[SAILPOINT_CHAT] Query failed:', error);
              return { error: error.message };
            }
          })
        );
        
        // Intelligent retry: If we got 0 results and used a filter, ask AI to analyze and suggest better query
        const hasEmptyResults = results.some(r => r.data && Array.isArray(r.data) && r.data.length === 0);
        const hasErrors = results.some(r => r.error);
        let retryAttempted = false;
        
        if (hasEmptyResults && queries.length === 1 && queries[0].filters) {
          logInfo(`[SAILPOINT_CHAT] Got 0 results with filter "${queries[0].filters}". Asking AI to analyze...`);
          
          try {
            // Ask AI why the query might have failed and suggest alternative
            const analysisPrompt = `The user asked: "${message}"
            
We executed this SailPoint query:
Action: ${queries[0].action}
Filter: ${queries[0].filters}

Result: 0 items found

This could mean:
1. The filter is too specific (e.g., looking for exact start "Cornerstone" when items start with "Fortitude-")
2. The search term should be in a different field
3. The data doesn't exist

Analyze why this query returned 0 results and suggest 1-2 alternative queries to try. Consider:
- If searching by name with "sw" (starts with), maybe items don't start with that text
- Could try removing filters to get all items first
- Could try a different field or approach

Respond with ONLY a JSON array of alternative SailPoint queries to try, or empty array [] if no alternatives make sense.`;

            const analysisResponse = await anythingllmRequest<{
              textResponse?: string;
            }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", {
              message: analysisPrompt,
              mode: 'chat',
              sessionId: 'system-sailpoint-analysis'
            });
            
            const analysisText = analysisResponse.textResponse || '';
            logInfo(`[SAILPOINT_CHAT] Analysis response: ${analysisText.substring(0, 200)}...`);
            
            // Try to extract alternative queries
            const altQueries = extractSailPointQueries(analysisText);
            
            if (altQueries.length > 0) {
              logInfo(`[SAILPOINT_CHAT] Retrying with ${altQueries.length} alternative ${altQueries.length === 1 ? 'query' : 'queries'}`);
              retryAttempted = true;
              
              const retryResults = await Promise.all(
                altQueries.map(async (query) => {
                  try {
                    logInfo(`[SAILPOINT_CHAT] Retry executing: ${query.action}`);
                    return await executeSailPointQuery(sailpointContext, query);
                  } catch (error: any) {
                    logError('[SAILPOINT_CHAT] Retry query failed:', error);
                    return { error: error.message };
                  }
                })
              );
              
              // Use retry results if they're better (have data)
              const retryHasData = retryResults.some(r => r.data && Array.isArray(r.data) && r.data.length > 0);
              if (retryHasData) {
                logInfo(`[SAILPOINT_CHAT] Retry succeeded! Using retry results.`);
                results = retryResults;
              } else {
                logInfo(`[SAILPOINT_CHAT] Retry also returned 0 results. Using original.`);
              }
            }
          } catch (analysisError: any) {
            logError('[SAILPOINT_CHAT] Analysis/retry failed:', analysisError);
            // Continue with original results
          }
        }
        
        // Format results - but limit size to avoid token issues
        const resultsText = formatQueryResults(results);
        
        // Add context about what happened
        let refinementInfo = '';
        if (retryAttempted) {
          const finalHasData = results.some(r => r.data && Array.isArray(r.data) && r.data.length > 0);
          refinementInfo = finalHasData 
            ? '\n\n[System Note: Initial query returned 0 results. Automatically retried with alternative approach and found data.]'
            : '\n\n[System Note: Initial query returned 0 results. Tried alternative queries but still found no matching data.]';
        } else if (hasEmptyResults || hasErrors) {
          refinementInfo = '\n\n[Note: Query returned no results or errors.]';
        }
        
        // Get final synthesis from LLM (hidden session)
        const synthesisPrompt = `Based on the following SailPoint query results, provide a clear answer to the user's question: "${message}"\n\n${resultsText}${refinementInfo}`;
        
        const finalResponse = await anythingllmRequest<{
          id: string;
          type: "abort" | "textResponse";
          textResponse?: string;
          sources?: Array<{ title: string; chunk: string }>;
          close?: boolean;
          error?: string | null;
        }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", {
          message: synthesisPrompt,
          mode: 'chat',
          sessionId: 'system-sailpoint-internal' // Hidden from user chat history
        });
        
        const finalText = finalResponse.textResponse || llmText;
        
        // Store the conversation in local DB for better control
        const conversationId = generateConversationId();
        
        try {
          // Store user message
          await storeChatMessage({
            workspaceSlug: slug,
            customerId: sailpointContext.customerId,
            role: 'user',
            content: message,
            conversationId,
            messageIndex: 0,
            sessionId: sessionId || 'user-interactive',
            isVisible: 1 // 1 = visible to user
          });
          
          // Store assistant response with SailPoint metadata
          await storeChatMessage({
            workspaceSlug: slug,
            customerId: sailpointContext.customerId,
            role: 'assistant',
            content: finalText,
            conversationId,
            messageIndex: 1,
            sessionId: sessionId || 'user-interactive',
            isVisible: 1, // 1 = visible to user
            sailpointContext: JSON.stringify({
              queriesExecuted: queries.length,
              queryActions: queries.map(q => q.action),
              results: results
            })
          });
          
          logInfo(`[SAILPOINT_CHAT] Conversation stored locally: ${conversationId}`);
        } catch (storeErr: any) {
          logError('[SAILPOINT_CHAT] Failed to store conversation locally:', storeErr);
          // Don't fail the request if storage fails
        }
        
        // Now store the complete conversation: user message + assistant response
        // Use normal chat mode with user sessionId which will store both properly
        const chatResponse = await anythingllmRequest<{
          id: string;
          type: "abort" | "textResponse";
          textResponse?: string;
          sources?: Array<{ title: string; chunk: string }>;
          close?: boolean;
          error?: string | null;
        }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", {
          ...req.body,
          message: message, // Original user message
          mode: mode || 'chat',
          sessionId: sessionId || 'user-interactive'
        });
        
        // Return the synthesized answer but with the chat response structure
        return res.json({
          ...chatResponse,
          textResponse: finalText,
          sailpointMetadata: {
            queriesExecuted: queries.length,
            queryActions: queries.map(q => q.action)
          }
        });
      }
    }
    
    // Normal chat (no SailPoint integration)
    const data = await anythingllmRequest<{
      id: string;
      type: "abort" | "textResponse";
      textResponse?: string;
      sources?: Array<{ title: string; chunk: string }>;
      close?: boolean;
      error?: string | null;
    }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", req.body ?? {});
    
    // Store normal chat messages in local DB if they're user-interactive
    const effectiveSessionId = sessionId || 'user-interactive';
    if (effectiveSessionId === 'user-interactive' && message && data.textResponse) {
      try {
        const conversationId = generateConversationId();
        
        // Try to get customer ID from workspace
        const customerContext = await getCustomerFromWorkspace(slug).catch(() => null);
        
        // Store user message
        await storeChatMessage({
          workspaceSlug: slug,
          customerId: customerContext?.customerId,
          role: 'user',
          content: message,
          conversationId,
          messageIndex: 0,
          sessionId: effectiveSessionId,
          isVisible: 1 // 1 = visible to user
        });
        
        // Store assistant response
        await storeChatMessage({
          workspaceSlug: slug,
          customerId: customerContext?.customerId,
          role: 'assistant',
          content: data.textResponse,
          conversationId,
          messageIndex: 1,
          sessionId: effectiveSessionId,
          isVisible: 1 // 1 = visible to user
        });
        
        logInfo(`[CHAT] Normal conversation stored locally: ${conversationId}`);
      } catch (storeErr: any) {
        logError('[CHAT] Failed to store conversation locally:', storeErr);
        // Don't fail the request if storage fails
      }
    }
    
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
 * Query (optional): limit, offset
 */
router.get("/workspace/:slug/thread/:threadSlug/chats", async (req, res) => {
  const { slug, threadSlug } = req.params;
  const { limit, offset } = req.query as {
    limit?: string | number;
    offset?: string | number;
  };

  try {
    const q = new URLSearchParams();
    if (limit) q.set("limit", String(limit));
    if (offset) q.set("offset", String(offset));
    const qs = q.toString() ? `?${q.toString()}` : "";

    const data = await anythingllmRequest<{
      history: Array<{
        role: "user" | "assistant" | string;
        content?: string;
        sentAt?: number;
        sources?: Array<Record<string, any>>;
      }>;
    }>(
      `/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chats${qs}`,
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
 * WORKSPACES: Stream Chat (SSE passthrough)
 * Proxies: POST /api/v1/workspace/:slug/stream-chat
 * Body: { message, mode: "query"|"chat", userId?, attachments? }
 * 
 * ENHANCED: Integrates SailPoint function calling for customer workspaces
 */
router.post("/workspace/:slug/stream-chat", async (req, res) => {
  const { slug } = req.params;
  const { message, mode, sessionId, useSailPoint, customerId, customerName } = req.body || {};

  try {
    // Only use SailPoint orchestration if explicitly requested via @sailpoint prefix
    const sailpointContext = useSailPoint ? await getCustomerFromWorkspace(slug) : null;
    
    if (sailpointContext && useSailPoint && mode !== 'query') {
      logInfo(`[SAILPOINT_STREAM] SailPoint query requested for workspace: ${slug}`);
      
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      try {
        // Get recent conversation history for context (last 3 messages to avoid token limits)
        const recentMessages = await getChatMessages(slug, {
          sessionId: 'user-interactive',
          onlyVisible: true,
          limit: 3,
          orderBy: 'desc'
        });
        
        // Build COMPACT conversation context (truncate long responses)
        const conversationContext = recentMessages.reverse().map((msg: any) => {
          const content = msg.content.length > 500 
            ? msg.content.substring(0, 500) + '...[truncated]'
            : msg.content;
          return `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}`;
        }).join('\n');

        // Step 1: Analyze and create intelligent query plan
        logInfo(`[SAILPOINT_STREAM] Creating intelligent query plan`);
        res.write(`data: ${JSON.stringify({ 
          type: 'status',
          textResponse: '[ANALYSIS] Analyzing your request...\n\n' 
        })}\n\n`);

        const plan = await analyzeAndPlanQuery(
          message,
          conversationContext,
          slug
        );

        logInfo(`[SAILPOINT_STREAM] Plan created: ${plan.estimatedSteps} steps`);
        res.write(`data: ${JSON.stringify({ 
          type: 'status',
          textResponse: `[PLAN] **Query Plan:** ${plan.userIntent}\n\n**Strategy:** ${plan.strategy}\n\n**Steps:** ${plan.estimatedSteps}\n\n` 
        })}\n\n`);

        // Step 2: Execute the plan with progress updates
        logInfo(`[SAILPOINT_STREAM] Executing plan`);
        
        const execution = await executeQueryPlan(
          plan,
          sailpointContext,
          (progress) => {
            // Send real-time progress updates
            switch (progress.type) {
              case 'step_started':
                res.write(`data: ${JSON.stringify({ 
                  type: 'status',
                  textResponse: `[STEP] Step ${progress.stepNumber}/${progress.totalSteps}: ${progress.description}\n\n` 
                })}\n\n`);
                break;
              
              case 'step_progress':
                res.write(`data: ${JSON.stringify({ 
                  type: 'status',
                  textResponse: `[STEP] ${progress.description}\n\n` 
                })}\n\n`);
                break;
              
              case 'step_completed':
                res.write(`data: ${JSON.stringify({ 
                  type: 'status',
                  textResponse: `[COMPLETE] Step ${progress.stepNumber}/${progress.totalSteps}: ${progress.description}\n   Fetched: ${progress.data?.itemsFetched || 0} items (Total: ${progress.data?.totalSoFar || 0})\n\n` 
                })}\n\n`);
                break;
              
              case 'step_failed':
                res.write(`data: ${JSON.stringify({ 
                  type: 'status',
                  textResponse: `[ERROR] Step ${progress.stepNumber}/${progress.totalSteps}: ${progress.description}\n\n` 
                })}\n\n`);
                break;
            }
          }
        );

        if (!execution.success) {
          res.write(`data: ${JSON.stringify({ 
            type: 'status',
            textResponse: `\n[WARNING] ${execution.summary}\n\n` 
          })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ 
            type: 'status',
            textResponse: `\n[SUCCESS] ${execution.summary}\n\n` 
          })}\n\n`);
        }

        // Step 3: Aggregate results intelligently
        logInfo(`[SAILPOINT_STREAM] Aggregating ${execution.results.length} results`);
        res.write(`data: ${JSON.stringify({ 
          type: 'status',
          textResponse: `[AGGREGATE] Analyzing data...\n\n` 
        })}\n\n`);

        const aggregatedData = aggregateForSynthesis(execution.results, plan.userIntent);

        // Step 4: Get LLM synthesis
        logInfo(`[SAILPOINT_STREAM] Getting LLM synthesis`);
        
        // Data is now pre-filtered to only required fields by the orchestrator
        // Trust the AI's field selection - no truncation needed
        // Modern LLMs have 128k+ token context windows (aggregated data is typically <10k tokens)
        logInfo(`[SAILPOINT_STREAM] Aggregated data size: ${aggregatedData.length} chars`);
        
        res.write(`data: ${JSON.stringify({ 
          type: 'status',
          textResponse: `[SYNTHESIS] Generating response...\n\n` 
        })}\n\n`);

        // Include discovered schema and required fields if available
        let schemaContext = '';
        if (execution.discoveredSchema) {
          const fieldNames = Object.keys(execution.discoveredSchema);
          schemaContext = `\n\nAvailable fields discovered (${fieldNames.length} total):\n${fieldNames.slice(0, 20).join(', ')}${fieldNames.length > 20 ? ', ...' : ''}`;
        }
        
        if (plan.requiredFields && plan.requiredFields.length > 0) {
          schemaContext += `\n\nFields being used for response (pre-filtered): ${plan.requiredFields.join(', ')}\n\nNote: Data has been pre-filtered to only include these ${plan.requiredFields.length} relevant fields.`;
        }

        // Build a summary of what was queried
        const querySummary = plan.steps
          .filter(s => s.status === 'completed')
          .map(s => `  - ${s.description}`)
          .join('\n');

        const synthesisPrompt = `User question: "${message}"

QUERY EXECUTION SUMMARY:
- Executed ${execution.metadata.completedSteps} query step${execution.metadata.completedSteps > 1 ? 's' : ''}
- Retrieved ${execution.metadata.totalItemsFetched} total items
${execution.metadata.failedSteps > 0 ? `- ${execution.metadata.failedSteps} step(s) failed\n` : ''}
Queries executed:
${querySummary}

IMPORTANT: The data below represents the COMPLETE results from all executed queries above. All the information needed to answer the user's question is provided below. Do not suggest running additional queries for data that has already been retrieved.

SailPoint query results:
${aggregatedData}${schemaContext}

FORMATTING INSTRUCTIONS:
Your response should be clear, natural, and easy to read. Follow these guidelines:

1. **Start with a summary**: Begin with the key finding or count (e.g., "Found 45 identities matching your criteria")

2. **Use appropriate formatting**:
   - For 5+ items of similar data → Use a Markdown table
   - For 2-4 items → Use bullet points
   - For single items → Use descriptive paragraphs with **bold** labels
   - For grouped data → Use headings (##) to separate sections

3. **Keep it scannable**:
   - Use **bold** for important values, names, or labels
   - Use line breaks between different topics
   - Don't force tables when a simple list is clearer

4. **Focus on relevant fields**:
   - If schema information is provided, use it to identify the most relevant fields for the user's question
   - Don't overwhelm with all available fields - pick the 3-5 most relevant ones
   - For example, if asked about "accounts", focus on: name, source, status, owner (not all 50+ fields)

4. **Example responses**:

For a list of users:
"Found **12 active identities** in the Engineering department:

| Name | Email | Status |
|------|-------|--------|
| John Smith | john.smith@company.com | Active |
| Jane Doe | jane.doe@company.com | Active |"

For a single item:
"Found identity **John Smith**:
- **Email**: john.smith@company.com
- **Department**: Engineering
- **Status**: Active
- **Last Login**: 2025-10-25"

For grouped data:
"## Active Users (8)
- John Smith, Jane Doe, Bob Johnson...

## Inactive Users (4)
- Alice Brown, Charlie Davis..."

Provide a natural, conversational response that's easy to read.`;
        
        logInfo(`[SAILPOINT_STREAM] Synthesis prompt length: ${synthesisPrompt.length} chars`);
        
        const finalResponse = await anythingllmRequest<{
          textResponse?: string;
        }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", {
          message: synthesisPrompt,
          mode: 'chat',
          sessionId: 'system-sailpoint-internal'
        });

        let finalText = finalResponse.textResponse || 'Query completed successfully.';

        // Step 5: Iterative refinement loop - keep trying until AI is satisfied with the answer
        const { detectNeedForAdditionalQueries } = await import('../services/sailpointQueryOrchestrator');
        const MAX_REFINEMENT_ITERATIONS = 20; // Safety limit to prevent infinite loops (should rarely be hit)
        let allResults = [...execution.results];
        let refinementIteration = 0;
        let consecutiveNoDataIterations = 0;
        const MAX_CONSECUTIVE_NO_DATA = 2; // Stop if we get no data twice in a row

        while (refinementIteration < MAX_REFINEMENT_ITERATIONS) {
          refinementIteration++;
          
          const refinementCheck = await detectNeedForAdditionalQueries(
            plan.userIntent,
            finalText,
            allResults,
            slug
          );

          if (!refinementCheck.needsAdditionalQueries || !refinementCheck.followUpPlan) {
            logInfo(`[SAILPOINT_STREAM] AI determined response is complete after ${refinementIteration - 1} refinement(s)`);
            res.write(`data: ${JSON.stringify({ 
              type: 'status',
              textResponse: `\n[COMPLETE] Response validated as complete after ${refinementIteration - 1} refinement iteration(s)\n\n` 
            })}\n\n`);
            break;
          }

          logInfo(`[SAILPOINT_STREAM] Refinement iteration ${refinementIteration}: AI needs ${refinementCheck.followUpPlan.steps.length} additional queries`);
          logInfo(`[SAILPOINT_STREAM] Reasoning: ${refinementCheck.reasoning}`);
          
          res.write(`data: ${JSON.stringify({ 
            type: 'status',
            textResponse: `\n[ITERATION ${refinementIteration}/${MAX_REFINEMENT_ITERATIONS}]\n${refinementCheck.reasoning}\nExecuting ${refinementCheck.followUpPlan.steps.length} additional ${refinementCheck.followUpPlan.steps.length === 1 ? 'query' : 'queries'}...\n\n`
          })}\n\n`);

          // Execute follow-up plan
          const followUpExecution = await executeQueryPlan(
            refinementCheck.followUpPlan,
            sailpointContext,
            (progress) => {
              // Send real-time progress updates for follow-up
              switch (progress.type) {
                case 'step_started':
                case 'step_progress':
                  res.write(`data: ${JSON.stringify({ 
                    type: 'status',
                    textResponse: `[ITERATION ${refinementIteration}] ${progress.description}\n\n` 
                  })}\n\n`);
                  break;
                
                case 'step_completed':
                  res.write(`data: ${JSON.stringify({ 
                    type: 'status',
                    textResponse: `[COMPLETE] ${progress.description}\n\n` 
                  })}\n\n`);
                  break;
                
                case 'step_failed':
                  res.write(`data: ${JSON.stringify({ 
                    type: 'status',
                    textResponse: `[ERROR] ${progress.description}\n\n` 
                  })}\n\n`);
                  break;
              }
            }
          );

          // Check if follow-up queries actually returned data
          if (!followUpExecution.success || followUpExecution.results.length === 0) {
            consecutiveNoDataIterations++;
            logInfo(`[SAILPOINT_STREAM] Iteration ${refinementIteration}: No new data (${consecutiveNoDataIterations}/${MAX_CONSECUTIVE_NO_DATA})`);
            
            if (consecutiveNoDataIterations >= MAX_CONSECUTIVE_NO_DATA) {
              logInfo(`[SAILPOINT_STREAM] Stopping: ${MAX_CONSECUTIVE_NO_DATA} consecutive iterations with no data`);
              res.write(`data: ${JSON.stringify({ 
                type: 'status',
                textResponse: `\n[STOPPING] Multiple queries returned no new data. Proceeding with available information.\n\n` 
              })}\n\n`);
              break;
            }
            
            res.write(`data: ${JSON.stringify({ 
              type: 'status',
              textResponse: `[INFO] Query returned no new data. Will try alternative approach if needed.\n\n` 
            })}\n\n`);
            continue; // Try again with AI suggesting different queries
          }

          // Reset consecutive no-data counter since we got data
          consecutiveNoDataIterations = 0;
          
          logInfo(`[SAILPOINT_STREAM] Iteration ${refinementIteration}: Retrieved ${followUpExecution.results.length} additional items (${allResults.length} → ${allResults.length + followUpExecution.results.length} total)`);
          
          // Combine all results
          allResults = [...allResults, ...followUpExecution.results];
          const combinedData = aggregateForSynthesis(allResults, plan.userIntent);

          // Re-synthesize with accumulated data
          res.write(`data: ${JSON.stringify({ 
            type: 'status',
            textResponse: `[SYNTHESIS] Generating response with ${allResults.length} total items...\n\n` 
          })}\n\n`);

          const iterativeSynthesisPrompt = `User question: "${message}"

SailPoint query results (${allResults.length} total items after ${refinementIteration} refinement iteration(s)):
${combinedData}

${refinementIteration > 1 ? `Previous response (was incomplete):\n${finalText}\n\n` : ''}

TASK: Provide a complete, comprehensive answer using ALL available data. If you now have enough information to fully answer the question, provide a complete response.

${synthesisPrompt.split('FORMATTING INSTRUCTIONS:')[1] || ''}`;

          const iterativeResponse = await anythingllmRequest<{
            textResponse?: string;
          }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", {
            message: iterativeSynthesisPrompt,
            mode: 'chat',
            sessionId: 'system-sailpoint-internal'
          });

          finalText = iterativeResponse.textResponse || finalText;
        }

        // Log refinement summary
        if (refinementIteration > 1) {
          logInfo(`[SAILPOINT_STREAM] Refinement complete: ${refinementIteration - 1} iteration(s), ${allResults.length} total items`);
          res.write(`data: ${JSON.stringify({ 
            type: 'status',
            textResponse: `\n✓ Refinement complete: ${refinementIteration - 1} iteration(s), ${allResults.length} total items\n\n` 
          })}\n\n`);
        }
        
        if (refinementIteration === MAX_REFINEMENT_ITERATIONS) {
          logInfo(`[SAILPOINT_STREAM] WARNING: Hit safety limit of ${MAX_REFINEMENT_ITERATIONS} iterations`);
          res.write(`data: ${JSON.stringify({ 
            type: 'status',
            textResponse: `\n[NOTE] Reached safety limit of ${MAX_REFINEMENT_ITERATIONS} iterations. Providing best available answer.\n\n` 
          })}\n\n`);
        }

        // Step 6: Stream the final response
        logInfo(`[SAILPOINT_STREAM] Streaming final response`);
        
        // Split response into words for smoother streaming
        const words = finalText.split(' ');
        for (let i = 0; i < words.length; i++) {
          const word = words[i] + (i < words.length - 1 ? ' ' : '');
          res.write(`data: ${JSON.stringify({ 
            type: 'chunk',
            textResponse: word 
          })}\n\n`);
          
          // Small delay for natural streaming
          await new Promise(resolve => setTimeout(resolve, 20));
        }

        // Step 7: Store locally with retry logic
        const conversationId = generateConversationId();
        
        try {
          await storeChatMessage({
            workspaceSlug: slug,
            customerId: sailpointContext.customerId,
            role: 'user',
            content: message,
            conversationId,
            messageIndex: 0,
            sessionId: sessionId || 'user-interactive',
            isVisible: 1
          });
          
          await storeChatMessage({
            workspaceSlug: slug,
            customerId: sailpointContext.customerId,
            role: 'assistant',
            content: finalText,
            conversationId,
            messageIndex: 1,
            sessionId: sessionId || 'user-interactive',
            isVisible: 1,
            sailpointContext: JSON.stringify({
              plan: plan.userIntent,
              stepsExecuted: execution.metadata.completedSteps,
              totalItemsFetched: execution.metadata.totalItemsFetched
            })
          });

          logInfo(`[SAILPOINT_STREAM] Conversation stored locally: ${conversationId}`);
        } catch (storeError: any) {
          logError('[SAILPOINT_STREAM] Failed to store conversation:', storeError);
          // Don't fail the stream if storage fails, but log it clearly
        }

        // Close stream
        res.write(`data: ${JSON.stringify({ 
          type: 'close',
          close: true,
          textResponse: '' 
        })}\n\n`);
        res.end();

        logInfo(`[SAILPOINT_STREAM] Response streamed successfully`);
        return;

      } catch (error: any) {
        logError('[SAILPOINT_STREAM] Error:', error);
        res.write(`data: ${JSON.stringify({ 
          type: 'abort',
          textResponse: null,
          close: true,
          error: error.message 
        })}\n\n`);
        res.end();
        return;
      }
    }
    
    // Normal streaming (no SailPoint or no queries detected)
    // Use non-streaming request to AnythingLLM, then stream the response ourselves
    // This avoids browser disconnection issues when piping streaming responses
    
    logInfo(`[STREAM_CHAT] Fetching response from AnythingLLM (non-streaming)`);

    // Set SSE headers FIRST
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    // Flush headers to establish connection immediately
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
      logInfo('[STREAM_CHAT] Headers flushed');
    }

    // Small delay before first write (mimicking SailPoint's async operations before first write)
    await new Promise(resolve => setTimeout(resolve, 10));

    // Send an immediate status message (not just a comment) to establish the stream
    // This is critical - the frontend needs to receive actual data, not just comments
    res.write(`data: ${JSON.stringify({ 
      type: 'status',
      textResponse: '' 
    })}\n\n`);

    // Abort if client disconnects
    const controller = new AbortController();
    const requestStartTime = Date.now();
    let clientDisconnected = false;
    
    req.on("close", () => {
      const elapsed = Date.now() - requestStartTime;
      logInfo(`[STREAM_CHAT] Client disconnected after ${elapsed}ms`);
      clientDisconnected = true;
      controller.abort();
    });

    // Send keepalives every 50ms while waiting for AnythingLLM response
    // IMPORTANT: Must send actual data messages, not just SSE comments
    const keepaliveInterval = setInterval(() => {
      if (!clientDisconnected && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ 
          type: 'status',
          textResponse: '' 
        })}\n\n`);
      }
    }, 50); // Every 50ms to prevent any timeout
    
    // Send first keepalive immediately (don't wait for interval)
    res.write(`data: ${JSON.stringify({ 
      type: 'status',
      textResponse: '' 
    })}\n\n`);

    try {
      // Make non-streaming request to AnythingLLM
      const chatResponse = await anythingllmRequest<{
        textResponse?: string;
        error?: string;
      }>(`/workspace/${encodeURIComponent(slug)}/chat`, "POST", req.body ?? {});

      // Clear keepalive interval now that we have the response
      clearInterval(keepaliveInterval);

      const fetchElapsed = Date.now() - requestStartTime;
      logInfo(`[STREAM_CHAT] Got response from AnythingLLM in ${fetchElapsed}ms`);

      // Check if client already disconnected
      if (clientDisconnected) {
        logInfo('[STREAM_CHAT] Client already disconnected, aborting');
        return;
      }

      if (chatResponse.error) {
        res.write(`data: ${JSON.stringify({ 
          type: 'abort', 
          error: chatResponse.error 
        })}\n\n`);
        res.end();
        return;
      }

      const fullText = chatResponse.textResponse || '';
      
      // Stream the response word-by-word for natural typing effect
      const words = fullText.split(' ');
      for (let i = 0; i < words.length; i++) {
        // Check if client disconnected
        if (controller.signal.aborted) {
          logInfo('[STREAM_CHAT] Client disconnected during streaming');
          return;
        }

        const word = words[i] + (i < words.length - 1 ? ' ' : '');
        res.write(`data: ${JSON.stringify({ 
          type: 'chunk',
          textResponse: word 
        })}\n\n`);
        
        // Small delay for natural streaming effect
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      // Store conversation locally
      const effectiveSessionId = sessionId || 'user-interactive';
      if (effectiveSessionId === 'user-interactive' && message && fullText) {
        try {
          const conversationId = generateConversationId();
          // Only query for customer context if this was a SailPoint query
          // For regular chat, use the customerId from request body if available
          const effectiveCustomerId = useSailPoint 
            ? (await getCustomerFromWorkspace(slug).catch(() => null))?.customerId
            : customerId;
          
          await storeChatMessage({
            workspaceSlug: slug,
            customerId: effectiveCustomerId,
            role: 'user',
            content: message,
            conversationId,
            messageIndex: 0,
            sessionId: effectiveSessionId,
            isVisible: 1
          });
          
          await storeChatMessage({
            workspaceSlug: slug,
            customerId: effectiveCustomerId,
            role: 'assistant',
            content: fullText,
            conversationId,
            messageIndex: 1,
            sessionId: effectiveSessionId,
            isVisible: 1
          });
          
          logInfo(`[STREAM_CHAT] Conversation stored locally: ${conversationId}`);
        } catch (storeErr: any) {
          logError('[STREAM_CHAT] Failed to store conversation locally:', storeErr);
        }
      }

      // Close stream
      res.write(`data: ${JSON.stringify({ 
        type: 'close',
        close: true,
        textResponse: '' 
      })}\n\n`);
      res.end();

      logInfo(`[STREAM_CHAT] Response streamed successfully`);
      
    } catch (err: any) {
      clearInterval(keepaliveInterval); // Clear interval on error
      logError('[STREAM_CHAT] Error:', err);
      if (!controller.signal.aborted && !clientDisconnected) {
        res.write(`data: ${JSON.stringify({ 
          type: 'abort', 
          error: err.message || 'Failed to get response from AnythingLLM' 
        })}\n\n`);
        res.end();
      }
    }
  } catch (outerErr: any) {
    logError('[STREAM_CHAT] Route error:', outerErr);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
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


