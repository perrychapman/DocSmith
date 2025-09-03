import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "../components/ui/input";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Icon } from "../components/icons";
import { A } from "../lib/api";
import WorkspaceChat from "../components/WorkspaceChat";
import { toast } from "sonner";

type Customer = { id: number; name: string; createdAt: string };
type UploadItem = { name: string; path: string; size: number; modifiedAt: string };

export function CustomersPage() {
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = React.useState(true);
  const [name, setName] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [loadingUploads, setLoadingUploads] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [embeddingMsg, setEmbeddingMsg] = React.useState<string>("");
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [wsSlug, setWsSlug] = React.useState<string | null>(null);
  const [wsLoading, setWsLoading] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const [deleteName, setDeleteName] = React.useState<string>("");
  const [alsoDeleteWorkspace, setAlsoDeleteWorkspace] = React.useState<boolean>(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [counts, setCounts] = React.useState<Record<number, { docs?: number; chats?: number }>>({});
  const [countsLoading, setCountsLoading] = React.useState(false);

  React.useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const r = await fetch(`/api/customers`);
        if (!r.ok) throw new Error(String(r.status));
        const data: Customer[] = await r.json();
        if (!ignore) {
          setCustomers(Array.isArray(data) ? data : []);
          if (!selectedId && data && data.length) setSelectedId(data[0].id);
        }
      } catch {
      } finally { if (!ignore) setLoadingCustomers(false) }
    })();
    return () => { ignore = true };
  }, [selectedId]);

  // Fetch per-customer counts (documents, chats) for list (one-shot)
  React.useEffect(() => {
    let ignore = false;
    async function loadCounts() {
      if (!customers.length) { setCounts({}); return; }
      setCountsLoading(true);
      try {
        const r = await fetch(`/api/customers/metrics`);
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json().catch(() => ({}));
        const metrics: Array<{ id: number; docs: number; chats: number }> = Array.isArray(data?.metrics) ? data.metrics : [];
        const map: Record<number, { docs?: number; chats?: number }> = {};
        for (const m of metrics) map[m.id] = { docs: m.docs, chats: m.chats };
        if (!ignore) setCounts(map);
      } catch {
        // Fallback per-customer (limited to first 10 to reduce load)
        const list = customers.slice(0, 10);
        const next: Record<number, { docs?: number; chats?: number }> = {};
        await Promise.allSettled(list.map(async (c) => {
          try {
            const r = await fetch(`/api/uploads/${c.id}`);
            const items: UploadItem[] = await r.json().catch(() => []);
            next[c.id] = { ...(next[c.id]||{}), docs: Array.isArray(items) ? items.length : 0 };
          } catch { next[c.id] = { ...(next[c.id]||{}), docs: 0 } }
          try {
            const ws = await fetch(`/api/customers/${c.id}/workspace`).then((r) => r.ok ? r.json() : Promise.reject()).catch(() => null);
            const slug = ws?.slug as string | undefined;
            if (slug) {
              const data = await A.workspaceChats(slug, 200, 'desc').catch(() => null);
              const arr = Array.isArray((data as any)?.history) ? (data as any).history : (Array.isArray((data as any)?.chats) ? (data as any).chats : (Array.isArray(data) ? (data as any) : []));
              next[c.id] = { ...(next[c.id]||{}), chats: Array.isArray(arr) ? arr.length : 0 };
            } else { next[c.id] = { ...(next[c.id]||{}), chats: 0 } }
          } catch { next[c.id] = { ...(next[c.id]||{}), chats: 0 } }
        }))
        if (!ignore) setCounts((prev) => ({ ...prev, ...next }));
      } finally {
        if (!ignore) setCountsLoading(false);
      }
    }
    loadCounts();
    return () => { ignore = true; };
  }, [customers]);

  // Keep docs count in sync with selected customer's uploads list
  React.useEffect(() => {
    if (!selectedId) return;
    setCounts((prev) => ({ ...prev, [selectedId]: { ...(prev[selectedId] || {}), docs: uploads.length } }));
  }, [uploads, selectedId]);

  // Live refresh chat count only for selected customer's workspace
  React.useEffect(() => {
    if (!selectedId || !wsSlug) return;
    let ignore = false;
    let timer: any;
    async function refreshChats() {
      try {
        const data = await A.workspaceChats(wsSlug!, 200, 'desc').catch(() => null);
        const arr = Array.isArray((data as any)?.history) ? (data as any).history : (Array.isArray((data as any)?.chats) ? (data as any).chats : (Array.isArray(data) ? (data as any) : []));
        const count = Array.isArray(arr) ? arr.length : 0;
        if (!ignore) setCounts((prev) => ({ ...prev, [selectedId]: { ...(prev[selectedId] || {}), chats: count } }));
      } catch {}
      if (!ignore) timer = setTimeout(refreshChats, 15000);
    }
    refreshChats();
    return () => { ignore = true; if (timer) clearTimeout(timer); };
  }, [selectedId, wsSlug]);

  // Resolve AnythingLLM workspace for selected customer
  React.useEffect(() => {
    let ignore = false;
    async function loadWs(cid: number) {
      setWsLoading(true);
      try {
        const r = await fetch(`/api/customers/${cid}/workspace`);
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        if (!ignore) setWsSlug(data?.slug || null);
      } catch {
        if (!ignore) setWsSlug(null);
      } finally {
        if (!ignore) setWsLoading(false);
      }
    }
    if (selectedId) loadWs(selectedId);
    else { setWsSlug(null); setWsLoading(false); }
    return () => { ignore = true };
  }, [selectedId]);

  React.useEffect(() => {
    let ignore = false;
    async function loadUploads(cid: number) {
      setLoadingUploads(true);
      try {
        const r = await fetch(`/api/uploads/${cid}`);
        if (!r.ok) throw new Error(String(r.status));
        const data: UploadItem[] = await r.json();
        if (!ignore) setUploads(Array.isArray(data) ? data : []);
      } catch {
        if (!ignore) setUploads([]);
      } finally {
        if (!ignore) setLoadingUploads(false);
      }
    }
    if (selectedId) loadUploads(selectedId);
    else setUploads([]);
    return () => { ignore = true };
  }, [selectedId]);

  // Live refresh uploads list for the selected customer
  React.useEffect(() => {
    if (!selectedId) return;
    let ignore = false;
    let timer: any;
    async function refresh() {
      try {
        const r = await fetch(`/api/uploads/${selectedId}`);
        if (!r.ok) throw new Error(String(r.status));
        const data: UploadItem[] = await r.json();
        if (!ignore) setUploads(Array.isArray(data) ? data : []);
      } catch {}
      if (!ignore) timer = setTimeout(refresh, 15000);
    }
    refresh();
    return () => { ignore = true; if (timer) clearTimeout(timer); };
  }, [selectedId]);

  async function add() {
    const n = name.trim();
    if (!n) return;
    try {
      await fetch(`/api/customers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n })});
      toast.success("Customer added");
      setName("");
      const r = await fetch(`/api/customers`);
      const data: Customer[] = await r.json();
      setCustomers(data);
      if (data.length) setSelectedId(data[0].id);
    } catch { toast.error("Failed to add customer") }
  }

  async function uploadFile() {
    if (!selectedId) { toast.error("Select a customer first"); return; }
    if (!file) { toast.error("Choose a file to upload"); return; }
    try {
      setUploading(true);
      setEmbeddingMsg("Uploading and embedding...");
      const toastId = (toast as any).loading ? (toast as any).loading("Uploading and embedding...") : undefined;
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/uploads/${selectedId}`, { method: "POST", body: fd });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(r.status));
      // refresh list
      const r2 = await fetch(`/api/uploads/${selectedId}`);
      const d2: UploadItem[] = await r2.json();
      setUploads(d2);
      setFile(null);
      if ((json as any)?.embeddingWarning) {
        toast.warning?.((json as any).embeddingWarning) ?? toast.success("Uploaded; embedding may still be processing");
      } else {
        // Treat completion of the request as embed completion signal
        if (toastId && toast.success) (toast as any).success("Embedding completed", { id: toastId });
        else toast.success("Embedding completed");
      }
      setUploadOpen(false);
    } catch {
      toast.error("Upload or embedding failed");
    } finally {
      setUploading(false);
      setEmbeddingMsg("");
    }
  }

  async function deleteUpload(name: string) {
    if (!selectedId) return;
    try {
      setDeleting(name);
      const loadingId = (toast as any).loading ? (toast as any).loading("Removing from workspace...") : undefined;
      const r = await fetch(`/api/uploads/${selectedId}?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(r.status));
      // refresh list
      const r2 = await fetch(`/api/uploads/${selectedId}`);
      const d2: UploadItem[] = await r2.json();
      setUploads(d2);
      const removed = Array.isArray((json as any)?.removedNames) ? (json as any).removedNames : [];
      if (removed.length) toast.success(`Removed ${removed.length} document${removed.length>1?'s':''}`);
      if ((json as any)?.documentsWarning) toast.warning?.((json as any).documentsWarning);
      if (loadingId && (toast as any).success) (toast as any).success("Removed", { id: loadingId });
      else toast.success("Removed");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(null);
    }
  }

  function startDelete(c: Customer) {
    setDeleteId(c.id);
    setDeleteName(c.name);
    setAlsoDeleteWorkspace(false);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteId) return;
    try {
      const url = `/api/customers/${deleteId}?deleteWorkspace=${alsoDeleteWorkspace ? "true" : "false"}`;
      const loadingId = (toast as any).loading ? (toast as any).loading("Deleting customer and workspace docs...") : undefined;
      const r = await fetch(url, { method: "DELETE" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(r.status));
      if ((body as any)?.documentsWarning) toast.warning?.((body as any).documentsWarning);
      if ((body as any)?.workspaceWarning) toast.warning?.((body as any).workspaceWarning);
      if (loadingId && (toast as any).success) (toast as any).success("Customer deleted", { id: loadingId });
      else toast.success("Customer deleted");
      setDeleteOpen(false);
      // refresh customers
      const rr = await fetch(`/api/customers`);
      const data: Customer[] = await rr.json();
      setCustomers(data);
      // adjust selection
      if (selectedId === deleteId) {
        const next = data[0]?.id ?? null;
        setSelectedId(next);
        setDocs([]);
      }
    } catch {
      toast.error("Failed to delete customer");
    }
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
            <BreadcrumbPage>Customers</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">Manage your customers and their documents</p>
        </div>
        {/* Header add removed; add form moved to customers panel */}
      </div>

      {(!loadingCustomers && customers.length === 0) ? (
        <Card className="p-10 flex flex-col items-center justify-center text-center space-y-3">
          <Icon.Folder className="h-10 w-10 text-muted-foreground" />
          <div className="text-lg font-semibold">Add your first customer</div>
          <div className="text-sm text-muted-foreground">Create a customer to start chatting and uploading documents.</div>
          <div className="flex items-center gap-2 w-full max-w-md">
            <Input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
            <Button onClick={add}><Icon.Plus className="h-4 w-4 mr-2"/>Add</Button>
          </div>
        </Card>
      ) : (
      <div className="grid grid-cols-12 gap-2 min-h-0">
        {/* Left: Customers list full-height */}
        <div className="col-span-12 md:col-span-4">
          <div className="sticky top-0">
            <Card className="h-[calc(100vh-160px)] overflow-hidden p-0">
              <div className="h-full p-4 space-y-3 overflow-y-auto">
                {/* Add form in panel */}
                {customers.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
                    <Button onClick={add}><Icon.Plus className="h-4 w-4 mr-2"/>Add</Button>
                  </div>
                )}
                {loadingCustomers ? (
                  <div className="text-muted-foreground text-sm">Loading.</div>
                ) : customers.length ? (
                  <ul className="space-y-1">
                    {customers.map((c) => (
                      <li key={c.id} className="flex items-center gap-2">
                        <button
                          className={
                            "flex-1 text-left px-3 py-2 rounded-md border hover:bg-accent/40 transition " +
                            (selectedId === c.id ? "bg-accent text-accent-foreground" : "")
                          }
                          onClick={() => setSelectedId(c.id)}
                          title={new Date(c.createdAt).toLocaleString()}
                        >
                          <div className="font-medium">{c.name}</div>
                          {counts[c.id]?.docs == null && counts[c.id]?.chats == null ? (
                            <div className="flex items-center gap-2 mt-0.5">
                              <div className="h-2 w-16 rounded bg-muted animate-pulse" />
                              <div className="h-2 w-16 rounded bg-muted animate-pulse" />
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {(() => {
                                const d = counts[c.id]?.docs;
                                const cm = counts[c.id]?.chats;
                                const dText = (d == null) ? '… docs' : `${d} doc${d===1?'':'s'}`;
                                const cText = (cm == null) ? '… chats' : `${cm} chat${cm===1?'':'s'}`;
                                return `${dText} • ${cText}`;
                              })()}
                            </div>
                          )}
                        </button>
                        <Button size="sm" variant="outline" onClick={() => startDelete(c)} title="Delete customer">
                          <Icon.Trash className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-muted-foreground text-sm">No customers yet.</div>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Right: Chat on top, Documents below */}
        <div className="col-span-12 md:col-span-8 grid grid-rows-[minmax(0,2fr)_minmax(0,1fr)] gap-2 h-[calc(100vh-160px)] min-h-0">
          {/* AI Chat */}
          {!selectedId ? (
            <Card className="p-4 text-sm text-muted-foreground h-full">Select a customer to open chat.</Card>
          ) : wsLoading ? (
            <Card className="p-4 text-sm text-muted-foreground h-full">Resolving workspace…</Card>
          ) : wsSlug ? (
            <WorkspaceChat slug={wsSlug} className="h-full" />
          ) : (
            <Card className="p-4 text-sm text-muted-foreground h-full">No workspace found for this customer.</Card>
          )}

          {/* Documents */}
          <Card className="p-4 h-full flex flex-col">
            <div className="flex items-end justify-between gap-3 mb-3 shrink-0">
              <div>
                <div className="font-medium">Documents</div>
                <div className="text-xs text-muted-foreground">
                  {selectedId ? (
                    <>For {customers.find((x) => x.id === selectedId)?.name || "selected customer"}</>
                  ) : (
                    <>Select a customer to view documents</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                  <DialogTrigger asChild>
                    <Button disabled={!selectedId}>
                      <Icon.Upload className="h-4 w-4 mr-2" />Upload
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Upload Document</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">Click the area below to attach a file, or drag and drop.</div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDrop={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          const f = e.dataTransfer?.files?.[0];
                          if (f) setFile(f);
                        }}
                        disabled={uploading}
                        className="w-full rounded-md border border-dashed p-6 text-center hover:bg-accent/40 transition flex flex-col items-center justify-center text-muted-foreground"
                      >
                        <Icon.Upload className="h-6 w-6 mb-1" />
                        <div className="font-medium">{file ? 'Change selected file' : 'Click to select a file'}</div>
                        <div className="text-xs mt-1 max-w-full truncate">{file ? file.name : 'or drag and drop here'}</div>
                      </button>
                      {uploading && (
                        <div className="text-xs text-muted-foreground">{embeddingMsg || "Processing..."}</div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
                      <Button onClick={uploadFile} disabled={!selectedId || !file || uploading}>
                        {uploading ? "Uploading..." : (<><Icon.Upload className="h-4 w-4 mr-2"/>Upload</>)}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {!selectedId ? (
                <div className="text-muted-foreground text-sm">Select a customer to view documents.</div>
              ) : loadingUploads ? (
                <div className="text-muted-foreground text-sm">Loading documents.</div>
              ) : uploads.length ? (
                <ul className="space-y-2">
                  {uploads.map((u, idx) => (
                    <li key={idx} className="border rounded-md px-3 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon.File className="h-4 w-4 text-muted-foreground" />
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.size} bytes</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-muted-foreground">{new Date(u.modifiedAt).toLocaleString()}</div>
                        <Button size="sm" variant="outline" disabled={uploading || deleting === u.name} onClick={() => deleteUpload(u.name)} title="Delete file">
                          {deleting === u.name ? 'Deleting...' : <Icon.Trash className="h-4 w-4" />}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted-foreground text-sm">No documents yet for this customer.</div>
              )}
            </div>
          </Card>
        </div>
      </div>
      )}

      {/* Delete Customer Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customer "{deleteName}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2 select-none">
              <input type="checkbox" checked={alsoDeleteWorkspace} onChange={(e) => setAlsoDeleteWorkspace(e.target.checked)} />
              Also delete the AnythingLLM workspace
            </label>
            <div className="text-muted-foreground">This cannot be undone.</div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CustomersPage;
