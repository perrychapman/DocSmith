import * as React from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Textarea } from "./ui/textarea";
import { Icon } from "./icons";
import { A } from "../lib/api";
import { readSSEStream } from "../lib/utils";

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
};

export default function WorkspaceChat({ slug, title = "AI Chat", className, headerActions, externalCards }: Props) {
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [threadSlug, setThreadSlug] = React.useState<string | undefined>(undefined);
  const [history, setHistory] = React.useState<any[]>([]);
  const [msg, setMsg] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  const [stream] = React.useState(true);
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
    const el = listRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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
    } finally { setLoading(false); scrollToBottom(); }
  }

  React.useEffect(() => { loadThreadsAndChats(); }, [slug]);
  React.useEffect(() => { if (atBottom) scrollToBottom(); }, [history, atBottom, scrollToBottom]);
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
        const r = await fetch('/api/generate/jobs');
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

    if (effectiveThread && stream) {
      try {
        const resp = await A.streamThread(slug, effectiveThread, body);
        if (!resp.ok || !resp.body) throw new Error(String(resp.status));
        let acc = "";
        await readSSEStream(resp, (payload) => {
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
      } catch {
        try {
          const r = await A.chatThread(slug, effectiveThread, body);
          const text = r?.textResponse || r?.response || JSON.stringify(r);
          setHistory((h) => [...h, { role: 'assistant', content: text, sentAt: Date.now() }]);
        } catch {}
      } finally {
        setReplying(false);
      }
      return;
    }

    try {
      const r = effectiveThread ? await A.chatThread(slug, effectiveThread, body) : await A.chatWorkspace(slug, body);
      const text = r?.textResponse || r?.response || JSON.stringify(r);
      setHistory((h) => [...h, { role: 'assistant', content: text, sentAt: Date.now() }]);
    } catch {
    } finally { setReplying(false) }
  }

  return (
    <Card className={("h-full min-h-0 p-0 flex flex-col " + (className || '')).trim()}>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b">
        <strong>{title}</strong>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">{threadSlug ? 'Default thread' : 'Workspace chat'}</div>
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
              const job = shouldHideAsCode ? latestRelevantJob() : null;
              const jobStatus = job?.status;
              // For generation prompts we inject our own sent card; skip rendering the raw prompt replacement
              if (shouldHideAsCode && isUser) return null;
              return (
                <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 ${isUser ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-card border rounded-bl-md'}`}>
                    {card ? (
                      <div className="space-y-1">
                        <div className="font-medium">
                          {isUser
                            ? (card.jobStatus === 'running' ? 'Document Generating' : 'Document Requested')
                            : 'Document Generated'}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {card.template ? <>Template: {card.template}</> : null}
                          {!isUser && card.filename ? <> · File: {card.filename}</> : null}
                        </div>
                        {isUser && card.aiContext ? (
                          <div className="text-xs text-muted-foreground">AI Context: {card.aiContext}</div>
                        ) : null}
                        <div className="flex items-center gap-2 pt-1">
                          {card.jobId ? (
                            isUser ? (
                              <a className="underline" href={`#jobs?id=${encodeURIComponent(card.jobId)}`}>View job</a>
                            ) : (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button asChild size="icon" variant="ghost" aria-label="Download" title="Download">
                                      <a href={`/api/generate/jobs/${encodeURIComponent(card.jobId)}/file?download=true`}>
                                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
                                      </a>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Download</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="icon" variant="ghost" aria-label="Open folder" title="Open folder" onClick={async (e)=>{ e.preventDefault(); try { await fetch(`/api/generate/jobs/${encodeURIComponent(card.jobId)}/reveal`) } catch {} }}>
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Open folder</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button asChild size="icon" variant="ghost" aria-label="View job" title="View job">
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
          <Button size="sm" variant="secondary" className="absolute right-4 bottom-32 rounded-full shadow" onClick={scrollToBottom} title="Scroll to bottom">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </Button>
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
          <Button
            onClick={send}
            disabled={replying}
            size="icon"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full h-10 w-10"
            title="Send"
            aria-label="Send"
          >
            <Icon.Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
