import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Icon } from "../components/icons";
import { A } from "../lib/api";
import { readSSEStream, cn } from "../lib/utils";
import { toast } from "sonner";

type Thread = { id?: number; slug?: string; name?: string };

export default function WorkspaceDetailPage({ slug }: { slug: string }) {
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [workspaceName, setWorkspaceName] = React.useState<string | undefined>(undefined);
  const [threadSlug, setThreadSlug] = React.useState<string | undefined>(() => (
    decodeURIComponent((location.hash.split('/')[3] || '').trim() || '') || undefined
  ));
  const [limit, setLimit] = React.useState(50);
  const [order, setOrder] = React.useState<"asc"|"desc">("desc");
  const [history, setHistory] = React.useState<any[]>([]);
  const [msg, setMsg] = React.useState("");
  const [mode, setMode] = React.useState<"chat"|"query">("chat");
  const [stream, setStream] = React.useState(true);
  const [loadingChats, setLoadingChats] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  // Modals
  const [createThreadOpen, setCreateThreadOpen] = React.useState(false);
  const [newThreadName, setNewThreadName] = React.useState("");
  const [renameThreadOpen, setRenameThreadOpen] = React.useState(false);
  const [renameThreadSlug, setRenameThreadSlug] = React.useState<string|undefined>();
  const [renameThreadValue, setRenameThreadValue] = React.useState("");
  const [deleteThreadOpen, setDeleteThreadOpen] = React.useState(false);
  const [deleteThreadSlug, setDeleteThreadSlug] = React.useState<string|undefined>();
  const [deleteThreadName, setDeleteThreadName] = React.useState<string|undefined>();
  const [renameWsOpen, setRenameWsOpen] = React.useState(false);
  const [renameWsValue, setRenameWsValue] = React.useState(slug);
  const [deleteWsOpen, setDeleteWsOpen] = React.useState(false);
  // Chat scroll management
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

  async function loadThreads(selectFirstIfMissing = true) {
    try {
      // Load workspace name + threads in parallel
      const [wsResp, thrResp] = await Promise.all([
        A.workspace(slug as string).catch(() => undefined),
        A.workspaceThreads(slug as string).catch(() => undefined)
      ]);
      const wsObj = wsResp?.workspace || (Array.isArray(wsResp) ? wsResp[0] : undefined) || wsResp;
      if (wsObj?.name) setWorkspaceName(wsObj.name);
      const data = thrResp;
      const list = Array.isArray(data?.threads) ? data.threads : [];
      setThreads(list);
      if (selectFirstIfMissing && !threadSlug && list[0]?.slug) {
        const t = String(list[0].slug);
        setThreadSlug(t);
        location.hash = `#workspaces/${encodeURIComponent(slug)}/thread/${encodeURIComponent(t)}`;
      }
      if (!list.length) toast.info('No threads found for this workspace');
    } catch { toast.error("Failed to load threads") }
  }

  async function loadChats() {
    setLoadingChats(true);
    try {
      let items: any[] = [];
      if (threadSlug) {
        const data = await A.threadChats(slug, threadSlug);
        items = Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []);
      } else {
        const data = await A.workspaceChats(slug, limit, order);
        items = Array.isArray(data?.history) ? data.history : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
      }
      setHistory(items);
    } catch {
      toast.error("Failed to load chats");
    } finally { setLoadingChats(false) }
  }

  React.useEffect(() => { loadThreads(); }, []);
  React.useEffect(() => { loadChats(); }, [threadSlug, limit, order]);
  React.useEffect(() => { scrollToBottom(); }, [history, scrollToBottom]);
  const showTyping = React.useMemo(() => {
    if (!replying) return false;
    let lastUser = -1, lastAssistant = -1;
    for (let i = 0; i < history.length; i++) {
      const r = String(history[i]?.role || '').toLowerCase();
      if (r === 'user') lastUser = i; else if (r === 'assistant') lastAssistant = i;
    }
    return lastAssistant <= lastUser;
  }, [replying, history]);

  async function createThread() {
    const name = newThreadName.trim();
    if (!name) return;
    try {
      await A.createThread(slug, name);
      toast.success("Thread created");
      setNewThreadName("");
      setCreateThreadOpen(false);
      await loadThreads(false);
    } catch { toast.error("Create failed") }
  }

  function startRenameThread(t: Thread) {
    setRenameThreadSlug(t.slug);
    setRenameThreadValue(t.name || t.slug || "");
    setRenameThreadOpen(true);
  }
  async function confirmRenameThread() {
    if (!renameThreadSlug || !renameThreadValue.trim()) return;
    try {
      await A.updateThread(slug, renameThreadSlug, renameThreadValue.trim());
      toast.success("Thread renamed");
      setRenameThreadOpen(false);
      await loadThreads(false);
    } catch { toast.error("Rename failed") }
  }

  function startDeleteThread(t: Thread) {
    setDeleteThreadSlug(t.slug);
    setDeleteThreadName(t.name || t.slug);
    setDeleteThreadOpen(true);
  }
  async function confirmDeleteThread() {
    if (!deleteThreadSlug) return;
    try {
      await A.deleteThread(slug, deleteThreadSlug);
      toast.success("Thread deleted");
      setDeleteThreadOpen(false);
      await loadThreads();
    } catch { toast.error("Delete failed") }
  }

  async function renameWorkspace() {
    if (!renameWsValue.trim()) return;
    try {
      await A.updateWorkspace(slug, { name: renameWsValue.trim() });
      toast.success("Workspace renamed");
      setRenameWsOpen(false);
    } catch { toast.error("Rename failed") }
  }

  async function deleteWorkspace() {
    try {
      await A.deleteWorkspace(slug);
      toast.success("Workspace deleted");
      setDeleteWsOpen(false);
      location.hash = '#workspaces';
    } catch { toast.error("Delete failed") }
  }

  async function send() {
    const t = msg.trim(); if (!t) return;
    setMsg("");
    // optimistic user message
    setHistory((h) => [...h, { role: 'user', content: t, sentAt: Date.now() }]);
    setReplying(true);
    const body = { message: t, mode };
    // Choose an effective thread if available
    const effectiveThread = threadSlug || (threads && threads[0]?.slug ? String(threads[0].slug) : undefined);
    if (!threadSlug && effectiveThread) setThreadSlug(effectiveThread);

    if (effectiveThread && stream) {
      try {
        const resp = await A.streamThread(slug, effectiveThread, body);
        if (!resp.ok || !resp.body) {
          // Fallback to non-stream when streaming is unavailable
          try {
            const r = await A.chatThread(slug, effectiveThread, body);
            const text = r?.textResponse || r?.response || JSON.stringify(r);
            setHistory((h) => [...h, { role: 'assistant', content: text, sentAt: Date.now() }]);
            await loadChats();
          } catch {
            toast.error('Failed to send message');
          }
          return;
        }
        let acc = "";
        await readSSEStream(resp, (payload) => {
          try {
            const j = JSON.parse(payload);
            // Support both textResponseChunk and arbitrary fields
            const piece = j?.textResponse ?? j?.text ?? j?.delta ?? j?.content ?? '';
            acc += String(piece);
          } catch {
            acc += payload;
          }
          setHistory((h) => {
            const base = h.slice();
            const last = base[base.length - 1];
            if (last && last.role === 'assistant') last.content = acc; else base.push({ role: 'assistant', content: acc, sentAt: Date.now() });
            return base;
          });
        });
        // refresh from server to ensure we reflect persisted chat
        await loadChats();
      } catch {
        toast.error('Failed to send message');
      } finally {
        setReplying(false);
      }
      return;
    }

    try {
      const r = effectiveThread ? await A.chatThread(slug, effectiveThread, body) : await A.chatWorkspace(slug, body);
      const text = r?.textResponse || r?.response || JSON.stringify(r);
      setHistory((h) => [...h, { role: 'assistant', content: text, sentAt: Date.now() }]);
      // pull latest history
      await loadChats();
    } catch {
      toast.error('Failed to send message');
    } finally { setReplying(false) }
  }

  async function resetConversation() {
    const body: any = { reset: true };
    try {
      if (threadSlug) await A.chatThread(slug, threadSlug, body); else await A.chatWorkspace(slug, body);
      toast.success('Conversation reset');
      await loadChats();
    } catch { toast.error('Reset failed') }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 animate-in fade-in-0 slide-in-from-top-2 sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-2 pb-2">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#workspaces">Workspaces</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{workspaceName || slug}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{workspaceName || slug}</h1>
            <p className="text-sm text-muted-foreground">Threads and chats</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setRenameWsOpen(true)}><Icon.Pencil className="h-4 w-4 mr-2"/>Rename</Button>
            <Button variant="destructive" onClick={() => setDeleteWsOpen(true)}><Icon.Trash className="h-4 w-4 mr-2"/>Delete</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-4 lg:col-span-3">
          <div className="sticky top-0 space-y-3">
          <Card className="p-4 space-y-3 max-h-[calc(100vh-160px)] overflow-y-auto">
            <div className="flex items-center justify-between">
              <strong>Threads</strong>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => setCreateThreadOpen(true)}><Icon.Plus className="h-4 w-4 mr-1"/>New</Button>
              </div>
            </div>
            <div className="space-y-2">
              {threads.length ? threads.map((t) => (
                <div key={t.slug || String(t.id)} className={"rounded-md border bg-card/40 hover:bg-accent/10 transition px-3 py-2 flex items-center justify-between " + (t.slug === threadSlug ? 'ring-1 ring-ring' : '')}>
                  <button className="text-left" onClick={() => { setThreadSlug(t.slug); location.hash = `#workspaces/${encodeURIComponent(slug)}/thread/${encodeURIComponent(t.slug || '')}`}}>
                    <div className="font-medium">{t.name || '(unnamed thread)'}</div>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startRenameThread(t)}><Icon.Pencil className="h-4 w-4"/></Button>
                    <Button variant="ghost" size="sm" onClick={() => startDeleteThread(t)}><Icon.Trash className="h-4 w-4"/></Button>
                  </div>
                </div>
              )) : <div className="text-sm text-muted-foreground">No threads yet.</div>}
            </div>
          </Card>
          </div>
        </div>

        <div className="col-span-12 md:col-span-8 lg:col-span-9 space-y-4">
          <Card className="p-4 hidden">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="text-sm text-muted-foreground">Limit</div>
                <Input type="number" className="w-20" value={limit} onChange={(e) => setLimit(Number(e.target.value || 0))} />
                <Select value={order} onValueChange={(v) => setOrder(v as any)}>
                  <SelectTrigger className="w-28"><SelectValue placeholder="Order"/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Newest</SelectItem>
                    <SelectItem value="asc">Oldest</SelectItem>
                  </SelectContent>
                </Select>
                {threadSlug ? (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} /> Stream</label>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={loadChats}><Icon.Refresh className="h-4 w-4 mr-2"/>Reload</Button>
                <Button variant="outline" onClick={resetConversation}>Reset</Button>
              </div>
            </div>
          </Card>

          <div className="relative">
          <Card className="p-0 [&>div:first-child]:hidden">
            <div className="text-sm text-muted-foreground">{loadingChats ? 'Loading chats…' : `${history.length} message${history.length === 1 ? '' : 's'}`}</div>
            <div ref={listRef} onScroll={onListScroll} className="h-[480px] overflow-y-auto px-4 py-4 space-y-2">
              {history.map((m, idx) => {
                const isUser = (m.role || '').toLowerCase() === 'user';
                const text = String(m.content || m.message || m.text || '');
                return (
                  <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 ${isUser ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-card border rounded-bl-md'}`}>
                      {text}
                    </div>
                  </div>
                );
              })}
              {showTyping && (
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
          </Card>
          {!atBottom && (
            <Button size="sm" variant="secondary" className="absolute right-4 bottom-20 rounded-full shadow" onClick={scrollToBottom} title="Scroll to bottom">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </Button>
          )}
          </div>

          <Card className="p-4 sticky bottom-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="space-y-2">
              <Textarea
                placeholder="Type a message"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div>Mode</div>
                  <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                    <SelectTrigger className="w-28"><SelectValue placeholder="Mode"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chat">Chat</SelectItem>
                      <SelectItem value="query">Query</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={loadChats}><Icon.Refresh className="h-4 w-4"/></Button>
                  <Button onClick={send}><Icon.Send className="h-4 w-4 mr-2"/>Send</Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
      {/* Create Thread Modal */}
      <Dialog open={createThreadOpen} onOpenChange={setCreateThreadOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Thread</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="Thread name" value={newThreadName} onChange={(e) => setNewThreadName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={createThread}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Thread Modal */}
      <Dialog open={renameThreadOpen} onOpenChange={setRenameThreadOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Thread</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="New name" value={renameThreadValue} onChange={(e) => setRenameThreadValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={confirmRenameThread}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Thread Confirm */}
      <AlertDialog open={deleteThreadOpen} onOpenChange={setDeleteThreadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete thread “{deleteThreadName}”?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteThread} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Workspace Modal */}
      <Dialog open={renameWsOpen} onOpenChange={setRenameWsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Workspace</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="New name" value={renameWsValue} onChange={(e) => setRenameWsValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={renameWorkspace}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Workspace Confirm */}
      <AlertDialog open={deleteWsOpen} onOpenChange={setDeleteWsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteWorkspace} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
