import * as React from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Icon } from "./icons";
import { A } from "../lib/api";
import { readSSEStream } from "../lib/utils";

type Thread = { id?: number; slug?: string; name?: string };

type Props = {
  slug: string;
  title?: string;
  className?: string;
};

export default function WorkspaceChat({ slug, title = "AI Chat", className }: Props) {
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [threadSlug, setThreadSlug] = React.useState<string | undefined>(undefined);
  const [history, setHistory] = React.useState<any[]>([]);
  const [msg, setMsg] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  const [stream] = React.useState(true);

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
        const items = sortOldestFirst(raw);
        setHistory(items);
      } else {
        const data = await A.workspaceChats(slug, 50, 'asc');
        const raw = Array.isArray(data?.history) ? data.history : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
        const items = sortOldestFirst(raw);
        setHistory(items);
      }
    } catch {
      setHistory([]);
    } finally { setLoading(false); scrollToBottom(); }
  }

  React.useEffect(() => { loadThreadsAndChats(); }, [slug]);
  React.useEffect(() => { if (atBottom) scrollToBottom(); }, [history, atBottom, scrollToBottom]);

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
          <Button size="sm" variant="secondary" onClick={loadThreadsAndChats} title="Refresh">
            <Icon.Refresh className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex">
        <div className="text-sm text-muted-foreground sr-only">{loading ? 'Loading chats.' : `${history.length} message${history.length === 1 ? '' : 's'}`}</div>
        <div ref={listRef} onScroll={onListScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-0 space-y-2">
            {history.map((m, idx) => {
              const isUser = (String(m.role || '')).toLowerCase() === 'user';
              const text = String(m.content || m.message || m.text || '');
              return (
                <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 ${isUser ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-card border rounded-bl-md'}`}>
                    {text}
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
