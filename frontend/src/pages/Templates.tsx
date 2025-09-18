import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Icon } from "../components/icons";
import { Progress } from "../components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";

type TItem = { slug: string; name?: string; dir?: string; hasTemplate?: boolean; hasDocx?: boolean; hasExcel?: boolean; hasSource?: boolean; hasFullGen?: boolean; compiledAt?: string; workspaceSlug?: string; updatedAt?: string; versionCount?: number };

export default function TemplatesPage() {
  const [items, setItems] = React.useState<TItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [compiling, setCompiling] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteSlug, setDeleteSlug] = React.useState<string | null>(null);

  // cleaned: no separate code state; use modal
  const [codeModal, setCodeModal] = React.useState<{ title: string; code: string } | null>(null);
  const [compLogs, setCompLogs] = React.useState<string[] | null>(null);
  const [compSteps, setCompSteps] = React.useState<Record<string, 'start' | 'ok'>>({});
  const [compProgress, setCompProgress] = React.useState<number | null>(null);
  const [compJobId, setCompJobId] = React.useState<string | null>(null);
  const compEsRef = React.useRef<EventSource | null>(null);
  const [q, setQ] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<string>("all"); // all|docx|excel|text
  const [sortBy, setSortBy] = React.useState<string>("recent"); // recent|name

  async function load() {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/templates`);
      const j = await r.json();
      setItems(Array.isArray(j?.templates) ? j.templates : []);
    } catch {
      setItems([]);
    } finally { setLoading(false) }
  }
  React.useEffect(() => { load(); }, []);



  // Only Full Generator is supported now

  async function viewFullGen(sl: string) {
    try {
      const r = await apiFetch(`/api/templates/${encodeURIComponent(sl)}/fullgen`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || r.status));
      setCodeModal({ title: 'Full Document Generator (generator.full.ts)', code: String(j.code || '') });
    } catch (e: any) { toast.error(e?.message ? String(e.message) : 'Failed to load full generator') }
  }

  // Rebuild Full Generator removed; compile consolidates this flow

  async function openFolder(sl: string) {
    try {
      const r = await apiFetch(`/api/templates/${encodeURIComponent(sl)}/reveal`);
      if (!r.ok) throw new Error(String(r.status));
      toast.success('Opened folder');
    } catch { toast.error('Failed to open folder'); }
  }

  async function copyPath(p?: string) {
    try { await navigator.clipboard.writeText(String(p || '')); toast.success('Path copied'); }
    catch { toast.error('Copy failed'); }
  }

  async function compile(sl: string) {
    try {
      setCompiling(sl)
      setCompLogs([]); setCompSteps({}); setCompProgress(0); setCompJobId(null)
      const es = new EventSource(`/api/templates/${encodeURIComponent(sl)}/compile/stream`)
      compEsRef.current = es
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}')
          if (data?.type === 'info') {
            if (data.usedWorkspace) setCompLogs((prev) => ([...(prev || []), `workspace:${String(data.usedWorkspace)}`]))
            if (data.jobId) setCompJobId(String(data.jobId))
          } else if (data?.type === 'log') {
            setCompLogs((prev) => ([...(prev || []), String(data.message || '')]))
          } else if (data?.type === 'step') {
            const name = String(data.name || '')
            const status = String(data.status || 'start') as 'start' | 'ok'
            const p = typeof data.progress === 'number' ? Math.max(0, Math.min(100, Math.floor(data.progress))) : null
            setCompSteps((prev) => ({ ...(prev || {}), [name]: status }))
            if (p != null) setCompProgress(p)
          } else if (data?.type === 'done') {
            setCompLogs((prev) => ([...(prev || []), 'done']))
            if (compEsRef.current) { compEsRef.current.close(); compEsRef.current = null }
            setCompiling(null); setCompProgress(100); setCompJobId(null)
            load()
          } else if (data?.type === 'error') {
            setCompLogs((prev) => ([...(prev || []), `error:${String(data.error || 'unknown')}`]))
            if (compEsRef.current) { compEsRef.current.close(); compEsRef.current = null }
            setCompiling(null); setCompJobId(null)
          }
        } catch { }
      }
      es.onerror = () => { setCompLogs((prev) => ([...(prev || []), 'error:stream'])); if (compEsRef.current) { compEsRef.current.close(); compEsRef.current = null }; setCompiling(null); setCompJobId(null) }
    } catch {
      setCompiling(null)
    }
  }

  async function openFolder(sl: string) {
    try {
      const r = await apiFetch(`/api/templates/${encodeURIComponent(sl)}/reveal`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || r.status));
      toast.success('Opened folder');
    } catch (e: any) { toast.error(e?.message || 'Failed to open folder'); }
  }

  async function copyPath(p?: string) {
    try { await navigator.clipboard.writeText(String(p || '')); toast.success('Path copied'); }
    catch { toast.error('Copy failed'); }
  }

  // Removed DOCX client-side rendering; server returns HTML for DOCX previews

  async function doUpload() {
    if (!file) { toast.error("Choose a file"); return; }
    try {
      setUploading(true);
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      if (slug.trim()) fd.append("slug", slug.trim());
      const r = await apiFetch(`/api/templates/upload`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(r.status));
      const ws = j?.workspaceSlug ? ` (Workspace: ${j.workspaceSlug})` : '';
      if (j?.warning) toast.warning?.(String(j.warning));
      toast.success(`Template uploaded${ws}${j?.hasScript ? ' • Script generated' : ''}`);
      setUploadOpen(false); setFile(null); setName(""); setSlug("");
      await load();
    } catch { toast.error("Upload failed") }
    finally { setUploading(false) }
  }

  // (legacy compile removed; using SSE compile above)

  function startDelete(sl: string) {
    setDeleteSlug(sl);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteSlug) return;
    try {
      const r = await apiFetch(`/api/templates/${encodeURIComponent(deleteSlug)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(r.status));
      if (j?.workspaceDeleted) {
        toast.success(`Template "${deleteSlug}" deleted (workspace ${j?.workspaceSlug || ''} removed)`);
      } else if (j?.workspaceSlug) {
        toast.success(`Template "${deleteSlug}" deleted (workspace ${j.workspaceSlug} not removed)`);
      } else {
        toast.success(`Template "${deleteSlug}" deleted`);
      }
      setDeleteOpen(false);
      setDeleteSlug(null);
      await load();
    } catch {
      toast.error("Delete failed");
    }
  }



  return (
    <div className="space-y-6 animate-in fade-in-0 slide-in-from-top-2">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#customers">DocSmith</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Templates</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">Upload and compile templates for document generation.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button><Icon.Upload className="h-4 w-4 mr-2" />Upload</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Upload Template Source</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
                <Input placeholder="Slug (optional)" value={slug} onChange={(e) => setSlug(e.target.value)} />
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
                    const f = (e as any).dataTransfer?.files?.[0] as File | undefined;
                    if (f) setFile(f);
                  }}
                  disabled={uploading}
                  className="w-full rounded-md border border-dashed p-6 text-center hover:bg-accent/40 transition flex flex-col items-center justify-center text-muted-foreground"
                >
                  <Icon.Upload className="h-6 w-6 mb-1" />
                  <div className="font-medium">{file ? 'Change selected file' : 'Click to select a file'}</div>
                  <div className="text-xs mt-1 max-w-full truncate">{file ? file.name : 'or drag and drop here'}</div>
                </button>
                <div className="text-xs text-muted-foreground">Supported: Markdown (.md), HTML (.html), Text (.txt), Word (.docx), Excel (.xlsx). Compile to Handlebars with AI after upload.</div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
                <Button onClick={doUpload} disabled={!file || uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="secondary" onClick={load}><Icon.Refresh className="h-4 w-4 mr-2" />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 min-h-0">
        {/* Cards list full width */}
        <div className="col-span-12">
          <Card className="p-4 h-[calc(100vh-220px)] flex flex-col">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading templates…</div>
            ) : items.length ? (
              <>
                {/* Fixed search/filter bar at top */}
                <div className="flex items-center gap-2 mb-4 flex-shrink-0">
                  <Input placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} className="w-[260px]" />
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="docx">Word (DOCX)</SelectItem>
                      <SelectItem value="excel">Excel (XLSX)</SelectItem>
                      <SelectItem value="text">Text/HTML/MD</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="Sort by" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recent">Recently modified</SelectItem>
                      <SelectItem value="name">Name (A–Z)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Scrollable content area */}
                <div className="flex-1 overflow-y-auto space-y-2">
                  {items
                    .filter((t) => !q || (t.name || t.slug).toLowerCase().includes(q.toLowerCase()) || t.slug.toLowerCase().includes(q.toLowerCase()))
                    .filter((t) => typeFilter === 'all' ? true : (typeFilter === 'docx' ? !!t.hasDocx : (typeFilter === 'excel' ? !!(t as any).hasExcel : !t.hasDocx && !((t as any).hasExcel))))
                    .sort((a, b) => sortBy === 'name' ? String(a.name || a.slug).localeCompare(String(b.name || b.slug)) : (new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()))
                    .map((t) => (
                      <div key={t.slug} className="rounded-md border bg-card/50 transition px-4 py-3">
                        {/* ... rest of your template item content stays the same ... */}
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">{t.name || t.slug}</div>
                            <div className="text-xs text-muted-foreground">{t.slug}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`text-xs px-2 py-0.5 rounded border ${t.hasFullGen ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{t.hasFullGen ? 'Compiled' : 'Not compiled'}</span>
                              </TooltipTrigger>
                              <TooltipContent>{t.hasFullGen ? 'Template has a generated FullGen script' : 'Template has not been compiled yet'}</TooltipContent>
                            </Tooltip>
                            <span className="text-xs px-2 py-0.5 rounded border">{t.hasDocx ? 'Word' : (t.hasExcel ? 'Excel' : 'Text')}</span>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">Workspace</div>
                            <div>{t.workspaceSlug || '—'}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Compiled</div>
                            <div>{t.compiledAt ? new Date(t.compiledAt).toLocaleString() : '—'}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Updated</div>
                            <div>{t.updatedAt ? new Date(t.updatedAt).toLocaleString() : '—'}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2 flex-wrap justify-end">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" aria-label="Open folder" title="Open Folder" onClick={async () => {
                                try {
                                  const r = await apiFetch(`/api/templates/${encodeURIComponent(t.slug)}/open-folder`, { method: 'POST' });
                                  if (!r.ok) throw new Error(String(r.status));
                                  toast.success('Opened folder');
                                } catch { toast.error('Failed to open folder') }
                              }}>
                                <Icon.Folder className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Open Folder</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" aria-label="Compile" title={compiling === t.slug ? 'Compiling' : (t.hasFullGen ? 'Recompile' : 'Compile')} onClick={() => compile(t.slug)} disabled={compiling === t.slug}>
                                <Icon.Refresh className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{compiling === t.slug ? 'Compiling' : (t.hasFullGen ? 'Recompile' : 'Compile')}</TooltipContent>
                          </Tooltip>
                          {t.hasFullGen ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" aria-label="View FullGen" title="View FullGen" onClick={() => viewFullGen(t.slug)}>
                                  <Icon.File className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View FullGen</TooltipContent>
                            </Tooltip>
                          ) : null}
                          <Button size="icon" variant="destructive" aria-label="Delete" title="Delete" onClick={() => startDelete(t.slug)}>
                            <Icon.Trash className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No templates yet. Upload one to get started.</div>
            )}
          </Card>
        </div>
      </div>


      {/* Delete Template Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template "{deleteSlug}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Code Modal */}
      <Dialog open={!!codeModal} onOpenChange={(v) => { if (!v) setCodeModal(null) }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle>{codeModal?.title || 'Code'}</DialogTitle></DialogHeader>
          <div className="border rounded-md bg-muted/30 px-3 py-2 h-96 overflow-auto text-sm">
            <pre className="whitespace-pre-wrap">{codeModal?.code || ''}</pre>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCodeModal(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compile Logs */}
      <Dialog open={!!compLogs} onOpenChange={(v) => { if (!v) { setCompLogs(null); setCompSteps({}); setCompProgress(null); setCompJobId(null); if (compEsRef.current) { compEsRef.current.close(); compEsRef.current = null } } }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Compile Logs</DialogTitle>
            <DialogDescription>Live status from template compilation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              {typeof compProgress === 'number' ? (
                <div className="mb-2"><Progress value={compProgress} /></div>
              ) : (
                <div className="mb-2"><Progress indeterminate /></div>
              )}
              <div className="text-xs text-muted-foreground">{compiling ? 'Running...' : (compProgress === 100 ? 'Completed' : 'Idle')}</div>
            </div>
            <div className="border rounded-md bg-muted/30 px-3 py-2 h-40 overflow-auto text-sm">
              <ul className="text-sm space-y-1">
                {['resolveTemplate', 'resolveWorkspace', 'readTemplate', 'extractSkeleton', 'buildPrompt', 'aiRequest', 'writeGenerator'].map((s) => (
                  <li key={s} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: compSteps[s] === 'ok' ? '#16a34a' : (compSteps[s] === 'start' ? '#f59e0b' : '#d4d4d8') }} />
                    <span className="capitalize">{s.replace(/([A-Z])/g, ' $1')}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border rounded-md bg-muted/30 px-3 py-2 h-40 overflow-auto text-sm">
              <pre className="whitespace-pre-wrap">{(compLogs || []).join('\n')}</pre>
            </div>
          </div>
          <DialogFooter>
            {compiling && compJobId ? (
              <Button variant="destructive" onClick={async () => { try { await apiFetch(`/api/templates/compile/jobs/${encodeURIComponent(compJobId)}/cancel`, { method: 'POST' }); setCompLogs((prev) => ([...(prev || []), 'cancel:requested'])) } catch { } }}>Cancel</Button>
            ) : null}
            <DialogClose asChild>
              <Button variant="secondary">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

