import * as React from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Textarea } from "./ui/textarea";
import { Icon } from "./icons";
import { toast } from "sonner";
import { A, apiFetch } from "../lib/api";
import { readSSEStream, formatTimeAgo } from "../lib/utils";

type Thread = { id?: number; slug?: string; name?: string };

type ExternalCard = {
  id: string;
  side?: 'user' | 'assistant';
  template?: string;
  jobId?: string;
  jobStatus?: 'running'|'done'|'error'|'cancelled';
  filename?: string;
  aiContext?: string;
  timestamp?: number;
};

type Props = {
  slug: string;
  title?: string;
  className?: string;
  headerActions?: React.ReactNode;
  externalCards?: ExternalCard[];
  onOpenLogs?: (jobId: string) => void;
  onOpenGenerate?: () => void;
};

export default function WorkspaceChat({ slug, title = "AI Chat", className, headerActions, externalCards, onOpenLogs, onOpenGenerate }: Props) {
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [threadSlug, setThreadSlug] = React.useState<string | undefined>(undefined);
  const [history, setHistory] = React.useState<any[]>([]);
  const [msg, setMsg] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  const [stream] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  // Jobs for this workspace (UI-only correlation to hide codey outputs)
  type Job = {
    id: string;
    customerId: number;
    customerName?: string;
    template: string;
    filename?: string;
    usedWorkspace?: string;
    startedAt: string;
    updatedAt: string;
    completedAt?: string;
    status: 'running'|'done'|'error'|'cancelled';
    file?: { path: string; name: string };
    error?: string;
  };
  const [wsJobs, setWsJobs] = React.useState<Job[]>([]);
  const injectedRef = React.useRef<Record<string, number>>({});

  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = React.useState(true);
  const scrollToBottom = React.useCallback(() => {
    const el = listRef.current; 
    if (!el) return;
    
    // Custom smooth scroll implementation for better cross-browser support
    const start = el.scrollTop;
    const target = el.scrollHeight - el.clientHeight;
    const duration = 300; // 300ms animation
    const startTime = performance.now();
    
    const animateScroll = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function for smooth animation
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      
      el.scrollTop = start + (target - start) * easeOutCubic;
      
      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      }
    };
    
    requestAnimationFrame(animateScroll);
  }, []);
  const onListScroll = React.useCallback(() => {
    const el = listRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    setAtBottom(near);
  }, []);

  async function loadThreadsAndChats() {
    setLoading(true);
    try {
      const thr = await A.workspaceThreads(slug);
      const list = Array.isArray(thr?.threads) ? thr.threads : [];
      setThreads(list);
      const tslug = (list[0]?.slug ? String(list[0].slug) : undefined);
      setThreadSlug(tslug);
      if (tslug) {
        const data = await A.threadChats(slug, tslug);
        const raw = Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []);
        let items = sortOldestFirst(raw);
        // Append persisted generation cards from backend
        try {
          const persisted = await A.genCardsByWorkspace(slug).catch(()=>({ cards: [] }));
          const cards: ExternalCard[] = Array.isArray((persisted as any)?.cards) ? (persisted as any).cards : [];
          if (cards.length) {
            const have = new Set(items.filter((m:any)=>m && m.card).map((m:any)=>String(m.card.id)));
            const mapped = cards.filter((c:any)=>!have.has(String(c.id))).map((c:any)=>({ role: (c.side || 'user'), content: '', sentAt: Number(c.timestamp||0)||Date.now(), card: { ...c } }));
            items = [...items, ...mapped];
          }
        } catch {}
        setHistory(items);
      } else {
        const data = await A.workspaceChats(slug, 50, 'asc');
        const raw = Array.isArray(data?.history) ? data.history : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
        let items = sortOldestFirst(raw);
        try {
          const persisted = await A.genCardsByWorkspace(slug).catch(()=>({ cards: [] }));
          const cards: ExternalCard[] = Array.isArray((persisted as any)?.cards) ? (persisted as any).cards : [];
          if (cards.length) {
            const have = new Set(items.filter((m:any)=>m && m.card).map((m:any)=>String(m.card.id)));
            const mapped = cards.filter((c:any)=>!have.has(String(c.id))).map((c:any)=>({ role: (c.side || 'user'), content: '', sentAt: Number(c.timestamp||0)||Date.now(), card: { ...c } }));
            items = [...items, ...mapped];
          }
        } catch {}
        setHistory(items);
      }
    } catch {
      setHistory([]);
    } finally { setLoading(false); }
  }

  React.useEffect(() => { loadThreadsAndChats(); }, [slug]);
  
  // Enhanced auto-scroll with smooth animations
  React.useEffect(() => { 
    if (atBottom && history.length > 0) {
      // Small delay to let DOM update, then smooth scroll
      const timeoutId = setTimeout(() => {
        scrollToBottom();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [history, atBottom, scrollToBottom]);
  // Inject external cards as synthetic assistant messages
  React.useEffect(() => {
    if (!externalCards || !externalCards.length) return;
    const map = injectedRef.current || {};
    setHistory((prev) => {
      let next = prev.slice();
      for (const c of externalCards) {
        const key = String(c.id);
        const ts = Number(c.timestamp || 0) || Date.now();
        const idx = next.findIndex((m: any) => !!m && m.card && String(m.card.id) === key);
        if (idx >= 0) {
          const old = next[idx] as any;
          next[idx] = { ...old, sentAt: ts, role: (c.side || 'user'), card: { ...(old.card || {}), ...c } };
        } else {
          next.push({ role: (c.side || 'user'), content: '', sentAt: ts, card: { ...c } });
        }
        map[key] = ts;
      }
      injectedRef.current = map;
      return next;
    });
  }, [externalCards]);
  // Poll jobs and keep only those for this workspace
  React.useEffect(() => {
    let cancelled = false;
    async function loadJobsOnce() {
      try {
        const r = await apiFetch('/api/generate/jobs');
        const j = await r.json().catch(()=>({}));
        const list: Job[] = Array.isArray(j?.jobs) ? j.jobs : [];
        const filtered = list.filter((x) => String(x?.usedWorkspace || '') === String(slug));
        filtered.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        if (!cancelled) setWsJobs(filtered);
      } catch { if (!cancelled) setWsJobs([]); }
    }
    loadJobsOnce();
    const t = setInterval(loadJobsOnce, 5000);
    return () => { cancelled = true; clearInterval(t) };
  }, [slug]);

  // Detect prompts/responses originating from DocSmith generation jobs
  const isGenJobPrompt = (txt: string) => {
    const s = String(txt || '').toLowerCase();
    if (!s) return false;
    return (
      (s.includes('current generator code:') && s.includes('docsmith')) ||
      (s.includes('you are a senior typescript engineer') && s.includes('docsmith'))
    );
  };
  const isGenJobResponse = (txt: string) => {
    const s = String(txt || '');
    if (!s) return false;
    if (/export\s+async\s+function\s+generate\s*\(/i.test(s)) return true;
    if (/```\s*ts[\s\S]*```/i.test(s)) return true;
    return false;
  };

  // Detect prompts/responses from metadata extraction (hidden from UI)
  const isMetadataPrompt = (txt: string) => {
    const s = String(txt || '').toLowerCase();
    if (!s) return false;
    // Must have multiple specific metadata indicators to avoid false positives
    const hasAnalyzeDocument = s.includes('please analyze the document named');
    const hasMetadataInstruction = s.includes('extract precise metadata') || s.includes('critical instructions');
    const hasDocumentType = (
      s.includes('this is a spreadsheet file') ||
      s.includes('this is a presentation file') ||
      s.includes('this is a code/script file') ||
      s.includes('this is an image file') ||
      s.includes('this is a document file')
    );
    return (hasAnalyzeDocument && hasMetadataInstruction) || (hasDocumentType && hasMetadataInstruction);
  };
  const isMetadataResponse = (txt: string) => {
    const s = String(txt || '');
    if (!s) return false;
    // Must be valid JSON AND have ALL the metadata-specific fields
    // AND have metadata structure indicators like arrays and specific field combinations
    try {
      const jsonMatch = s.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return false;
      const parsed = JSON.parse(jsonMatch[0]);
      // Must have documentType AND at least 3 other metadata-specific fields
      const hasDocType = parsed.hasOwnProperty('documentType');
      const hasPurpose = parsed.hasOwnProperty('purpose');
      const hasKeyTopics = parsed.hasOwnProperty('keyTopics');
      const hasDataCategories = parsed.hasOwnProperty('dataCategories');
      const hasStakeholders = parsed.hasOwnProperty('stakeholders');
      const hasMentionedSystems = parsed.hasOwnProperty('mentionedSystems');
      
      const metadataFieldCount = [hasPurpose, hasKeyTopics, hasDataCategories, hasStakeholders, hasMentionedSystems].filter(Boolean).length;
      
      return hasDocType && metadataFieldCount >= 3;
    } catch {
      return false;
    }
  };

  const looksLikeCode = (txt: string) => {
    const s = String(txt || '');
    if (!s) return false;
    if (/```/.test(s)) return true;
    const lines = s.split(/\r?\n/);
    const codeKeywords = /(\bfunction\b|\bclass\b|\binterface\b|\bconst\b|\blet\b|\bexport\b|\bimport\b|<\/?[a-z][^>]*>)/i;
    const punctScore = (s.match(/[{};<>]/g) || []).length;
    const keywordHits = lines.reduce((acc, l) => acc + (codeKeywords.test(l) ? 1 : 0), 0);
    return lines.length >= 6 && (keywordHits >= 3 || punctScore >= 6);
  };
  const latestRelevantJob = () => wsJobs[0];

  function sortOldestFirst(arr: any[]): any[] {
    if (!Array.isArray(arr) || arr.length <= 1) return arr || [];
    const toMs = (m: any) => {
      const v = m?.createdAt ?? m?.created_at ?? m?.sentAt ?? m?.timestamp ?? m?.date;
      const n = v ? new Date(v).getTime() : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    const withT = arr.map((m, i) => ({ m, i, t: toMs(m) }));
    const hasAny = withT.some(x => typeof x.t === 'number');
    if (!hasAny) return arr.slice();
    const a = withT[0].t ?? withT[0].i;
    const b = withT[withT.length - 1].t ?? withT[withT.length - 1].i;
    const isDesc = typeof a === 'number' && typeof b === 'number' ? (a > b) : false;
    if (isDesc) return arr.slice().reverse();
    return arr.slice();
  }

  async function send() {
    const t = msg.trim(); if (!t) return;
    setMsg("");
    setHistory((h) => [...h, { role: 'user', content: t, sentAt: Date.now() }]);
    setReplying(true);
    const body = { message: t, mode: 'chat' } as any;
    const effectiveThread = threadSlug || (threads && threads[0]?.slug ? String(threads[0].slug) : undefined);
    if (!threadSlug && effectiveThread) setThreadSlug(effectiveThread);

    // Try streaming first (works for both thread and workspace)
    if (stream) {
      try {
        const resp = effectiveThread 
          ? await A.streamThread(slug, effectiveThread, body)
          : await A.streamWorkspace(slug, body);
        
        if (!resp.ok || !resp.body) throw new Error(String(resp.status));
        let acc = "";
        let firstChunk = true;
        await readSSEStream(resp, (payload) => {
          if (firstChunk) {
            setReplying(false); // Hide dots as soon as first chunk arrives
            firstChunk = false;
          }
          try {
            const j = JSON.parse(payload);
            const piece = j?.textResponse ?? j?.text ?? j?.delta ?? j?.content ?? '';
            acc += String(piece);
          } catch { acc += payload; }
          setHistory((h) => {
            const base = h.slice();
            const last = base[base.length - 1];
            if (last && last.role === 'assistant') last.content = acc; else base.push({ role: 'assistant', content: acc, sentAt: Date.now() });
            return base;
          });
        });
        setReplying(false); // Ensure dots are hidden after stream completes
      } catch (err) {
        console.error('[WorkspaceChat] Streaming failed, falling back to non-streaming:', err);
        // Fallback to non-streaming chat
        try {
          const r = effectiveThread ? await A.chatThread(slug, effectiveThread, body) : await A.chatWorkspace(slug, body);
          const text = r?.textResponse || r?.response || JSON.stringify(r);
          setHistory((h) => [...h, { role: 'assistant', content: text, sentAt: Date.now() }]);
        } catch (err2) {
          console.error('[WorkspaceChat] Non-streaming also failed:', err2);
        }
      } finally {
        setReplying(false);
      }
      return;
    }

    // Non-streaming fallback
    try {
      const r = effectiveThread ? await A.chatThread(slug, effectiveThread, body) : await A.chatWorkspace(slug, body);
      const text = r?.textResponse || r?.response || JSON.stringify(r);
      setHistory((h) => [...h, { role: 'assistant', content: text, sentAt: Date.now() }]);
    } catch {
    } finally { setReplying(false) }
  }

async function exportHistory() {
  if (exporting) return;
  setExporting(true);
  try {
    const effectiveThread = threadSlug || (threads[0]?.slug ? String(threads[0].slug) : undefined);
    const fetchLimit = 500;

    let base: any[] = [];
    if (effectiveThread) {
      const data = await A.threadChats(slug, effectiveThread);
      base = Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []);
    } else {
      const data = await A.workspaceChats(slug, fetchLimit, "asc");
      base = Array.isArray(data?.history)
        ? data.history
        : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
    }

    let merged = sortOldestFirst(base);

    try {
      const persisted = await A.genCardsByWorkspace(slug).catch(() => ({ cards: [] }));
      const cards: ExternalCard[] = Array.isArray((persisted as any)?.cards) ? (persisted as any).cards : [];
      if (cards.length) {
        const have = new Set(merged.filter((m: any) => m && m.card).map((m: any) => String(m.card.id)));
        const mapped = cards
          .filter((c: any) => !have.has(String(c.id)))
          .map((c: any) => ({
            role: c.side || "user",
            content: "",
            sentAt: Number(c.timestamp || 0) || Date.now(),
            card: { ...c },
          }));
        if (mapped.length) merged = [...merged, ...mapped];
      }
    } catch (err) {
      console.error("Failed to merge persisted cards for export", err);
    }

    if (externalCards && externalCards.length) {
      const have = new Set(merged.filter((m: any) => m && m.card).map((m: any) => String(m.card.id)));
      for (const c of externalCards) {
        const key = String(c.id);
        if (have.has(key)) continue;
        merged.push({
          role: c.side || "user",
          content: "",
          sentAt: Number(c.timestamp || 0) || Date.now(),
          card: { ...c },
        });
        have.add(key);
      }
    }

    merged = sortOldestFirst(merged);

    const safeClone = (value: any) => JSON.parse(JSON.stringify(value ?? null));
    const toIso = (value: any) => {
      if (value == null) return null;
      const n = typeof value === "number" ? value : Date.parse(String(value));
      if (!Number.isFinite(n)) return null;
      return new Date(n).toISOString();
    };

    const exportMessages = merged.map((message, index) => {
      const cloned = safeClone(message);
      const baseTimestamp =
        cloned?.sentAt ?? cloned?.createdAt ?? cloned?.created_at ?? cloned?.timestamp ?? cloned?.date ?? null;
      const textValue = cloned?.content ?? cloned?.message ?? cloned?.text ?? "";
      return {
        index,
        role: cloned?.role != null ? String(cloned.role) : null,
        text: typeof textValue === "string" ? textValue : String(textValue ?? ""),
        timestamp: toIso(baseTimestamp),
        timestampRaw: baseTimestamp ?? null,
        card: cloned?.card ?? undefined,
        sources: cloned?.sources ?? cloned?.documents ?? cloned?.context ?? undefined,
        raw: cloned,
      };
    });

    const metadata: Record<string, any> = {
      workspaceSlug: slug,
      threadSlug: effectiveThread ?? null,
      exportedAt: new Date().toISOString(),
      messageCount: exportMessages.length,
      includesExternalCards: Boolean(externalCards && externalCards.length),
      messages: exportMessages,
    };

    if (threads.length) {
      metadata.threads = threads.map((t) => ({
        slug: t?.slug != null ? String(t.slug) : null,
        name: t?.name != null ? String(t.name) : null,
      }));
    }

    const sanitizeSegment = (value?: string) => {
      if (!value) return null;
      const cleaned = value.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      return cleaned ? cleaned.toLowerCase() : null;
    };

    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const stamp = `${datePart}-${timePart}`;

    const segments = ["docsmith", "chat"];
    const safeWorkspace = sanitizeSegment(slug) ?? "workspace";
    segments.push(safeWorkspace);
    const safeThread = sanitizeSegment(effectiveThread);
    if (safeThread) segments.push(safeThread);
    const filename = `${segments.join("-")}-${stamp}.json`;

    const payload = JSON.stringify(metadata, null, 2);

    if (typeof window === "undefined" || typeof document === "undefined") {
      throw new Error("Export is only supported in a browser environment");
    }

    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    const successMessage = exportMessages.length
      ? `Exported ${exportMessages.length} chat message${exportMessages.length === 1 ? "" : "s"}`
      : "Chat history exported (no messages yet)";
    toast.success(successMessage);
  } catch (error) {
    console.error("Failed to export chat history", error);
    toast.error("Failed to export chat history");
  } finally {
    setExporting(false);
  }
}

return (
    <Card className={("h-full min-h-0 p-0 flex flex-col " + (className || '')).trim()}>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b">
        <strong>{title}</strong>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Export chat history"
                disabled={exporting || loading}
                onClick={(e) => {
                  e.preventDefault();
                  void exportHistory();
                }}
              >
                {exporting ? (
                  <Icon.Refresh className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon.Download className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export chat</TooltipContent>
          </Tooltip>
          {headerActions}
        </div>

      </div>
      <div className="relative flex-1 min-h-0 flex">
        <div className="text-sm text-muted-foreground sr-only">{loading ? 'Loading chats.' : `${history.length} message${history.length === 1 ? '' : 's'}`}</div>
        <div ref={listRef} onScroll={onListScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-0 space-y-2">
            {history.map((m, idx) => {
              const isUser = (String(m.role || '')).toLowerCase() === 'user';
              const text = String(m.content || m.message || m.text || '');
              const card = (m as any).card as ExternalCard | undefined;
              const shouldHideAsCode = (isGenJobPrompt(text) || isGenJobResponse(text) || (!isUser && looksLikeCode(text)));
              const isMetadata = (isMetadataPrompt(text) || isMetadataResponse(text));
              const job = shouldHideAsCode ? latestRelevantJob() : null;
              const jobStatus = job?.status;
              
              // Extract timestamp from message
              const timestamp = m.sentAt ?? m.createdAt ?? m.created_at ?? m.timestamp ?? m.date;
              const timeAgo = formatTimeAgo(timestamp);
              
              // Hide metadata extraction prompts and responses completely
              if (isMetadata) return null;
              
              // Hide all generation job messages (prompts and responses)
              // Only show cards for these, not the raw AI messages
              if (shouldHideAsCode) return null;
              
              // Only show cards and genuine user messages
              // Cards are injected separately, so messages without cards that aren't job-related are real user chats
              return (
                <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className="group flex flex-col gap-1 max-w-[75%]">
                    <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 ${isUser ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-card border rounded-bl-md'}`}>
                      {card ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium flex-1">
                              {isUser
                                ? 'Document Requested'
                                : (card.jobStatus === 'running' 
                                    ? 'Document Generating' 
                                    : card.jobStatus === 'done' 
                                      ? 'Document Generated'
                                      : card.jobStatus === 'error'
                                        ? 'Generation Failed'
                                        : 'Document Generation'
                                  )}
                            </div>
                            {/* Status Badge */}
                            {card.jobStatus === 'running' && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1 shrink-0">
                                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                Running
                              </span>
                            )}
                            {card.jobStatus === 'done' && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 flex items-center gap-1 shrink-0">
                                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                                Done
                              </span>
                            )}
                            {card.jobStatus === 'error' && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 flex items-center gap-1 shrink-0">
                                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>
                                Error
                              </span>
                            )}
                            {card.jobStatus === 'cancelled' && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20 shrink-0">
                                Cancelled
                              </span>
                            )}
                          </div>
                          <div className="text-sm opacity-90">
                            {card.template ? (<div>Template: {card.template}</div>) : null}
                            {!isUser && card.filename ? (<div>File: {card.filename}</div>) : null}
                          </div>
                          {isUser && card.aiContext ? (
                            <div className="text-xs opacity-75">AI Context: {card.aiContext}</div>
                          ) : null}
                          <div className="flex items-center gap-2 pt-1">
                            {card.jobId ? (
                              isUser ? (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button asChild size="icon" variant="ghost" aria-label="View job details">
                                        <a href={`#jobs?id=${encodeURIComponent(card.jobId)}`}>
                                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
                                        </a>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>View job details & logs</TooltipContent>
                                  </Tooltip>
                                  {onOpenLogs ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button size="icon" variant="ghost" aria-label="View generation progress" onClick={(e)=>{ e.preventDefault(); onOpenLogs?.(card.jobId!) }}>
                                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>View generation progress</TooltipContent>
                                    </Tooltip>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button asChild size="icon" variant="ghost" aria-label="Download">
                                        <a href={`/api/generate/jobs/${encodeURIComponent(card.jobId)}/file?download=true`}>
                                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
                                        </a>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Download</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button size="icon" variant="ghost" aria-label="Open folder" onClick={async (e)=>{ e.preventDefault(); try { await apiFetch(`/api/generate/jobs/${encodeURIComponent(card.jobId || '')}/reveal`) } catch {} }}>
                                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Open folder</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button asChild size="icon" variant="ghost" aria-label="View job">
                                        <a href={`#jobs?id=${encodeURIComponent(card.jobId)}`}>
                                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
                                        </a>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>View job</TooltipContent>
                                  </Tooltip>
                                </>
                              )
                            ) : (
                              <a className="underline" href="#jobs">View jobs</a>
                            )}
                          </div>
                        </div>
                      ) : shouldHideAsCode ? (
                        null
                      ) : (
                        <>{text}</>
                      )}
                    </div>
                    {timeAgo && (
                      <div className={`text-xs text-muted-foreground px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'text-right' : 'text-left'}`}>
                        {timeAgo}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {replying && (
              <div className="flex justify-start">
                <div className="max-w-[75%] rounded-2xl px-3.5 py-2.5 bg-card border rounded-bl-md">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce"></span>
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0.15s]"></span>
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0.3s]"></span>
                  </div>
                </div>
              </div>
            )}
        </div>
        {!atBottom && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="secondary" className="absolute right-4 bottom-4 rounded-full shadow" onClick={scrollToBottom}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Scroll to bottom</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="px-2.5 border-t h-24 flex items-center">
        <div className="relative w-full">
          <Textarea
            placeholder="Type a message"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); send(); } }}
            className="flex-1 w-full pr-12 resize-none h-14 max-h-40"
          />
          {onOpenGenerate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Generate document"
                  className="absolute right-14 top-1/2 -translate-y-1/2 rounded-full h-10 w-10"
                  onClick={() => onOpenGenerate?.()}>
                  <Icon.DocSparkles className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Generate</TooltipContent>
            </Tooltip>
          ) : null}
          <Button
            onClick={send}
            disabled={replying}
            size="icon"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full h-10 w-10"
            aria-label="Send"
          >
            <Icon.Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}





