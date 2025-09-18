import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { Icon } from "../components/icons";
import { Search } from "lucide-react";
import { A } from "../lib/api";
import { toast } from "sonner";
import WorkspaceChat from "../components/WorkspaceChat";

type Thread = { id?: number; slug?: string; name?: string; title?: string; threadName?: string; thread_name?: string; [key: string]: any };

export default function WorkspaceDetailPage({ slug }: { slug: string }) {
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [workspaceName, setWorkspaceName] = React.useState<string | undefined>(undefined);
  const [threadSlug, setThreadSlug] = React.useState<string | undefined>(() => (
    decodeURIComponent((location.hash.split('/')[3] || '').trim() || '') || undefined
  ));
  const [threadSearch, setThreadSearch] = React.useState("");
  
  // Client-side thread name management
  const [threadNames, setThreadNames] = React.useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem(`threadNames-${slug}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Save thread names to localStorage whenever they change
  React.useEffect(() => {
    try {
      localStorage.setItem(`threadNames-${slug}`, JSON.stringify(threadNames));
    } catch {
      // Ignore localStorage errors
    }
  }, [threadNames, slug]);

  // Helper function to get thread name (local first, then API)
  const getThreadName = React.useCallback((thread: Thread) => {
    const localName = threadNames[thread.slug || ''];
    return localName || thread.name || thread.title || thread.threadName || thread.thread_name || '(unnamed thread)';
  }, [threadNames]);

  // Helper function to set thread name locally
  const setThreadName = React.useCallback((threadSlug: string, name: string) => {
    setThreadNames(prev => ({ ...prev, [threadSlug]: name }));
  }, []);
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

  async function loadThreads(selectFirstIfMissing = true) {
    try {
      // Load workspace data which includes basic thread info (slug, user_id)
      const wsResp = await A.workspace(slug as string);
      
      // Handle different response formats based on AnythingLLM API
      const workspace = wsResp?.workspace || (Array.isArray(wsResp) ? wsResp[0] : undefined) || wsResp;
      
      if (workspace?.name) setWorkspaceName(workspace.name);
      
      // Extract threads from workspace response
      const list = Array.isArray(workspace?.threads) ? workspace.threads : [];
      
      console.log('Loaded threads:', list);
      console.log('Local thread names:', threadNames);
      
      setThreads(list);
      if (selectFirstIfMissing && !threadSlug && list[0]?.slug) {
        const t = String(list[0].slug);
        setThreadSlug(t);
        location.hash = `#workspaces/${encodeURIComponent(slug)}/thread/${encodeURIComponent(t)}`;
      }
      if (!list.length) toast.info('No threads found for this workspace');
    } catch { toast.error("Failed to load threads") }
  }

  React.useEffect(() => { loadThreads(); }, [slug]);

  async function createThread() {
    const name = newThreadName.trim();
    if (!name) return;
    try {
      const response = await A.createThread(slug, name);
      console.log('Thread creation response:', response);
      
      setNewThreadName("");
      setCreateThreadOpen(false);
      toast.success("Thread created");
      
      // Store thread name locally immediately
      if (response?.thread?.slug) {
        setThreadName(response.thread.slug, name);
        setThreadSlug(response.thread.slug);
        location.hash = `#workspaces/${encodeURIComponent(slug)}/thread/${encodeURIComponent(response.thread.slug)}`;
      }
      
      // Add a small delay to ensure the backend has processed the thread creation
      await new Promise(resolve => setTimeout(resolve, 500));
      await loadThreads();
      
    } catch { toast.error("Failed to create thread") }
  }

  function startRenameThread(thread: Thread) {
    setRenameThreadSlug(thread.slug);
    setRenameThreadValue(getThreadName(thread));
    setRenameThreadOpen(true);
  }

  async function confirmRenameThread() {
    if (!renameThreadSlug || !renameThreadValue.trim()) return;
    try {
      // Update local storage immediately
      setThreadName(renameThreadSlug, renameThreadValue.trim());
      
      // Try to update via API (but don't fail if it doesn't work)
      try {
        await A.updateThread(slug, renameThreadSlug, renameThreadValue.trim());
      } catch (apiError) {
        console.log('API thread update failed (continuing with local update):', apiError);
      }
      
      setRenameThreadOpen(false);
      toast.success("Thread renamed");
      
      // Refresh thread list to sync any API changes
      await loadThreads();
    } catch { toast.error("Failed to rename thread") }
  }

  function startDeleteThread(thread: Thread) {
    setDeleteThreadSlug(thread.slug);
    setDeleteThreadName(getThreadName(thread));
    setDeleteThreadOpen(true);
  }

  async function confirmDeleteThread() {
    if (!deleteThreadSlug) return;
    try {
      await A.deleteThread(slug, deleteThreadSlug);
      
      // Clean up local storage for deleted thread
      setThreadNames(prev => {
        const updated = { ...prev };
        delete updated[deleteThreadSlug];
        return updated;
      });
      
      setDeleteThreadOpen(false);
      toast.success("Thread deleted");
      if (threadSlug === deleteThreadSlug) {
        setThreadSlug(undefined);
        location.hash = `#workspaces/${encodeURIComponent(slug)}`;
      }
      await loadThreads();
    } catch { toast.error("Failed to delete thread") }
  }

  async function renameWorkspace() {
    const name = renameWsValue.trim();
    if (!name) return;
    try {
      await A.updateWorkspace(slug, { name });
      setWorkspaceName(name);
      setRenameWsOpen(false);
      toast.success("Workspace renamed");
    } catch { toast.error("Failed to rename workspace") }
  }

  async function deleteWorkspace() {
    try {
      await A.deleteWorkspace(slug);
      setDeleteWsOpen(false);
      toast.success("Workspace deleted");
      location.hash = "#workspaces";
    } catch { toast.error("Failed to delete workspace") }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 animate-in fade-in-0 slide-in-from-top-2">
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
            <p className="text-sm text-muted-foreground">AI workspace chat</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setRenameWsOpen(true)}><Icon.Pencil className="h-4 w-4 mr-2"/>Rename</Button>
            <Button variant="destructive" onClick={() => setDeleteWsOpen(true)}><Icon.Trash className="h-4 w-4 mr-2"/>Delete</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-4 lg:col-span-3">
          <Card className="h-[calc(100vh-200px)] overflow-hidden border-0 shadow-lg">
            <div className="p-4 border-b border-border/40 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Threads</span>
                <Button size="sm" onClick={() => setCreateThreadOpen(true)}>
                  <Icon.Plus className="h-4 w-4 mr-1"/>New
                </Button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {threads.length ? (
                <div className="space-y-2">
                  {threads.map((t) => (
                    <div
                      key={t.slug || String(t.id)}
                      role="button"
                      tabIndex={0}
                      className={
                        "group relative rounded-lg border p-3 transition-all duration-200 cursor-pointer hover:shadow-md " +
                        (t.slug === threadSlug 
                          ? "bg-primary/10 border-primary/50 shadow-sm" 
                          : "hover:bg-accent/50 hover:border-accent")
                      }
                      onClick={() => { setThreadSlug(t.slug); location.hash = `#workspaces/${encodeURIComponent(slug)}/thread/${encodeURIComponent(t.slug || '')}`}}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setThreadSlug(t.slug);
                          location.hash = `#workspaces/${encodeURIComponent(slug)}/thread/${encodeURIComponent(t.slug || '')}`;
                        }
                      }}
                      title={`Thread: ${getThreadName(t)}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate text-sm">{getThreadName(t)}</div>
                        </div>
                        
                        {/* Right: actions (rename, delete) */}
                        <div className="opacity-60 group-hover:opacity-100 transition-opacity duration-200 ml-2 flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              startRenameThread(t);
                            }}
                            aria-label={`Rename ${getThreadName(t)}`}
                            title={`Rename ${getThreadName(t)}`}
                            className="h-9 w-9"
                          >
                            <Icon.Pencil className="h-4 w-4"/>
                          </Button>
                          <Tooltip>
                            <TooltipTrigger>
                              <Button 
                                size="icon"
                                variant="destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  startDeleteThread(t);
                                }}
                                aria-label={`Delete ${getThreadName(t)}`}
                                title={`Delete ${getThreadName(t)}`}
                                className="h-9 w-9"
                              >
                                <Icon.Trash className="h-4 w-4"/>
                              </Button>
                            </TooltipTrigger>
                          </Tooltip>
                        </div>
                      </div>
                      
                      {/* Selection indicator */}
                      {t.slug === threadSlug && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r" />
                      )}
                    </div>
                  ))}
                </div>
              ) : <div className="text-sm text-muted-foreground">No threads yet.</div>}
            </div>
          </Card>
        </div>

        <div className="col-span-12 md:col-span-8 lg:col-span-9">
          <div className="h-[calc(100vh-200px)]">
            <WorkspaceChat
              slug={slug}
              title={threadSlug ? getThreadName(threads.find(t => t.slug === threadSlug) || {}) : 'Workspace Chat'}
              className="h-full"
            />
          </div>
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
            <AlertDialogTitle>Delete thread "{deleteThreadName}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteThread} className="!bg-destructive !text-destructive-foreground !hover:bg-destructive/90 !border-destructive">Delete</AlertDialogAction>
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