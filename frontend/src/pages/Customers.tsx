import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "../components/ui/input";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Icon } from "../components/icons";
import WorkspaceChat from "../components/WorkspaceChat";
import { toast } from "sonner";

type Customer = { id: number; name: string; createdAt: string };
type DocRow = { id: number; customerId: number; type: string; filePath?: string; createdAt: string };

export function CustomersPage() {
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = React.useState(true);
  const [name, setName] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [docs, setDocs] = React.useState<DocRow[]>([]);
  const [loadingDocs, setLoadingDocs] = React.useState(false);
  const [docType, setDocType] = React.useState("");
  const [wsSlug, setWsSlug] = React.useState<string | null>(null);
  const [wsLoading, setWsLoading] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<number | null>(null);
  const [deleteName, setDeleteName] = React.useState<string>("");
  const [alsoDeleteWorkspace, setAlsoDeleteWorkspace] = React.useState<boolean>(false);

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
    async function loadDocs(cid: number) {
      setLoadingDocs(true);
      try {
        const r = await fetch(`/api/documents/${cid}`);
        if (!r.ok) throw new Error(String(r.status));
        const data: DocRow[] = await r.json();
        if (!ignore) setDocs(Array.isArray(data) ? data : []);
      } catch {
        if (!ignore) setDocs([]);
      } finally {
        if (!ignore) setLoadingDocs(false);
      }
    }
    if (selectedId) loadDocs(selectedId);
    else setDocs([]);
    return () => { ignore = true };
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

  async function addDoc() {
    const type = docType.trim();
    if (!selectedId) { toast.error("Select a customer first"); return; }
    if (!type) { toast.error("Document type is required"); return; }
    try {
      const r = await fetch(`/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: selectedId, type })
      });
      if (!r.ok) throw new Error(String(r.status));
      setDocType("");
      // refresh docs
      const r2 = await fetch(`/api/documents/${selectedId}`);
      const d2: DocRow[] = await r2.json();
      setDocs(d2);
      toast.success("Document created");
    } catch {
      toast.error("Failed to create document");
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
      const r = await fetch(url, { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      toast.success("Customer deleted");
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
        <div className="flex items-center gap-2">
          <Input placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={add}><Icon.Plus className="h-4 w-4 mr-2"/>Add</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-2 min-h-0">
        {/* Left: Customers list full-height */}
        <div className="col-span-12 md:col-span-4">
          <div className="sticky top-0">
            <Card className="h-[calc(100vh-160px)] overflow-hidden p-0">
              <div className="h-full p-4 space-y-3 overflow-y-auto">
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
                          <span className="font-medium">{c.name}</span>
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
                <Input placeholder="Document type (e.g. Proposal)" value={docType} onChange={(e) => setDocType(e.target.value)} />
                <Button disabled={!selectedId} onClick={addDoc}><Icon.Plus className="h-4 w-4 mr-2"/>Add</Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {!selectedId ? (
                <div className="text-muted-foreground text-sm">Select a customer to view documents.</div>
              ) : loadingDocs ? (
                <div className="text-muted-foreground text-sm">Loading documents.</div>
              ) : docs.length ? (
                <ul className="space-y-2">
                  {docs.map((d) => (
                    <li key={d.id} className="border rounded-md px-3 py-2 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{d.type}</div>
                        <div className="text-xs text-muted-foreground">{d.filePath || "(no file)"}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</div>
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
