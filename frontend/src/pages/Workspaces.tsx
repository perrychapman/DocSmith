import * as React from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { ScrollArea } from "../components/ui/scroll-area";
import { Badge } from "../components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";
import { Icon } from "../components/icons";
import { Search } from "lucide-react";
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

  // Search/filter
  const [searchQuery, setSearchQuery] = React.useState("");

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

  // Filter workspaces by search query
  const filteredItems = React.useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return items;
    return items.filter(ws => 
      (ws.name?.toLowerCase().includes(query)) || 
      (ws.slug?.toLowerCase().includes(query))
    );
  }, [items, searchQuery]);

  return (
    <div className="flex flex-col h-full space-y-6 animate-in fade-in-0 slide-in-from-top-2">
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
              <p className="text-muted-foreground">Manage your AI knowledge spaces</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            <Icon.Refresh className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Icon.Plus className="h-4 w-4 mr-2" />
                Create Workspace
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Workspace</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Input 
                  placeholder="Workspace name" 
                  className="h-9" 
                  value={createName} 
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && create()}
                />
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={!createName.trim()}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search workspaces..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Workspaces list with scrolling */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <Card className="p-6 h-full flex items-center justify-center">
            <div className="flex items-center text-muted-foreground">
              <Icon.Refresh className="h-5 w-5 mr-2 animate-spin" />
              Loading workspaces...
            </div>
          </Card>
        ) : error ? (
          <Card className="p-6 h-full flex items-center justify-center">
            <div className="text-sm text-destructive">{error}</div>
          </Card>
        ) : filteredItems.length === 0 ? (
          <Card className="p-12 h-full flex items-center justify-center">
            <div className="flex flex-col items-center justify-center text-center space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Icon.Bot className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No workspaces found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchQuery ? 'Try a different search term' : 'Create your first workspace to get started'}
                </p>
              </div>
              {!searchQuery && (
                <Button onClick={() => setCreateOpen(true)} className="mt-2">
                  <Icon.Plus className="h-4 w-4 mr-2" />
                  Create Workspace
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <Card className="p-6 h-full flex flex-col min-h-0 overflow-hidden">
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-2 pr-4">
                {filteredItems.map((ws, i) => (
                  <div
                    key={(ws.slug || 'ws') + i}
                    className="rounded-md border bg-card/50 hover:bg-accent/10 transition px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 w-full sm:w-auto flex-1">
                      <span className="font-medium block truncate">{ws.name || '(unnamed)'}</span>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {Array.isArray(ws.threads) && (
                          <Badge variant="secondary" className="text-xs">
                            {ws.threads.length} thread{ws.threads.length === 1 ? '' : 's'}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground truncate">{ws.slug}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                      <Button size="sm" onClick={() => open(ws.slug)} className="flex-1 sm:flex-none">
                        <Icon.Folder className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Open</span>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => startRename(ws.slug, ws.name)} className="flex-1 sm:flex-none">
                        <Icon.Pencil className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Rename</span>
                      </Button>
                      <Button size="sm" variant="destructive" className="flex-1 sm:flex-none" onClick={() => startDelete(ws.slug, ws.name)}>
                        <Icon.Trash className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Delete</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-4">
        <span>Powered by AnythingLLM</span>
        {!loading && filteredItems.length > 0 && (
          <span>{filteredItems.length} workspace{filteredItems.length === 1 ? '' : 's'}</span>
        )}
      </div>

      {/* Rename Workspace Modal */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input 
              placeholder="New name" 
              value={renameValue} 
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
            />
          </div>
          <DialogFooter>
            <Button onClick={confirmRename} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Workspace Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace "{deleteName}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the workspace and all its threads. This action cannot be undone.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
