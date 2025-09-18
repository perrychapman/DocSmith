import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";
import { Icon } from "../components/icons";
import { A } from "../lib/api";
import { toast } from "sonner";

type Workspace = { name?: string; slug?: string; threads?: any[] };

export default function WorkspacesPage() {
  const [items, setItems] = React.useState<Workspace[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Create modal
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");

  // Rename modal
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameSlug, setRenameSlug] = React.useState<string | undefined>();
  const [renameValue, setRenameValue] = React.useState("");

  // Delete confirm
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteSlug, setDeleteSlug] = React.useState<string | undefined>();
  const [deleteName, setDeleteName] = React.useState<string | undefined>();

  async function load() {
    setLoading(true); setError(null);
    try {
      const data = await A.workspaces();
      let ws = Array.isArray(data) ? data : (Array.isArray(data?.workspaces) ? data.workspaces : []);
      // Also fetch threads per workspace to enrich counts/details (normalized route)
      ws = await Promise.all(ws.map(async (w: any) => {
        if (!w?.slug) return w;
        try {
          const thr = await A.workspaceThreads(w.slug);
          const threads = Array.isArray(thr?.threads) ? thr.threads : [];
          return { ...w, threads };
        } catch { return w }
      }));
      setItems(ws);
      if (!ws.length) toast.info("No workspaces found");
    } catch (e: any) {
      setError("Failed to load workspaces. Check AnythingLLM config.");
      toast.error("Failed to load workspaces");
    } finally { setLoading(false) }
  }

  React.useEffect(() => { load(); }, []);

  async function create() {
    const name = createName.trim();
    if (!name) return;
    try {
      await A.createWorkspace(name);
      toast.success("Workspace created");
      setCreateName("");
      setCreateOpen(false);
      await load();
    } catch { toast.error("Create failed") }
  }

  function open(slug?: string) {
    if (!slug) return;
    location.hash = `#workspaces/${encodeURIComponent(slug)}`;
  }

  function startRename(slug?: string, currentName?: string) {
    setRenameSlug(slug);
    setRenameValue(currentName || slug || "");
    setRenameOpen(true);
  }

  async function confirmRename() {
    if (!renameSlug || !renameValue.trim()) return;
    try {
      await A.updateWorkspace(renameSlug, { name: renameValue.trim() });
      toast.success("Workspace renamed");
      setRenameOpen(false);
      await load();
    } catch { toast.error("Rename failed") }
  }

  function startDelete(slug?: string, currentName?: string) {
    setDeleteSlug(slug);
    setDeleteName(currentName || slug);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteSlug) return;
    try {
      await A.deleteWorkspace(deleteSlug);
      // Cleanup persisted generation cards for this workspace
      try { await A.deleteGenCardsByWorkspace(deleteSlug) } catch {}
      toast.success("Workspace deleted");
      setDeleteOpen(false);
      await load();
    } catch { toast.error("Delete failed") }
  }

  return (
    <div className="space-y-6 animate-in fade-in-0 slide-in-from-top-2">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#workspaces">DocSmith</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Workspaces</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon.Bot className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Workspaces</h1>
                <p className="text-muted-foreground">Create and manage AI workspaces</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={load}><Icon.Refresh className="h-4 w-4 mr-2" />Refresh</Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button><Icon.Plus className="h-4 w-4 mr-2" />Create</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Workspace</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                  <Input placeholder="Workspace name" className="h-9" value={createName} onChange={(e) => setCreateName(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button onClick={create}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
      </div>
      <Card className="p-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : items.length ? (
          <div className="space-y-2">
            {items.map((ws, i) => (
              <div key={(ws.slug || 'ws') + i}
                className="rounded-md border bg-card/50 hover:bg-accent/10 transition px-4 py-3 flex items-center justify-between">
                <div className="space-x-2">
                  <span className="font-medium">{ws.name || '(unnamed)'}</span>
                  {Array.isArray(ws.threads) ? <span className="text-muted-foreground text-xs">{ws.threads.length} thread{ws.threads.length === 1 ? '' : 's'}</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => open(ws.slug)}><Icon.Folder className="h-4 w-4 mr-2" />Open</Button>
                  <Button size="sm" variant="ghost" onClick={() => startRename(ws.slug, ws.name)}><Icon.Pencil className="h-4 w-4 mr-2" />Rename</Button>
                  <Button size="sm" variant="destructive" onClick={() => startDelete(ws.slug, ws.name)}><Icon.Trash className="h-4 w-4 mr-2" />Delete</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No workspaces found.</div>
        )}
      </Card>

      <Separator />
      <div className="text-xs text-muted-foreground">Powered by AnythingLLM</div>

      {/* Rename Workspace Modal */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input placeholder="New name" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={confirmRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Workspace Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace “{deleteName}”?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
