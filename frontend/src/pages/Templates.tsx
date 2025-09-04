import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Icon } from "../components/icons";
import { Progress } from "../components/ui/progress";
import { toast } from "sonner";

type TItem = { slug: string; name?: string; hasTemplate?: boolean; hasSource?: boolean; hasFullGen?: boolean; compiledAt?: string; workspaceSlug?: string; updatedAt?: string };

export default function TemplatesPage() {
  const [items, setItems] = React.useState<TItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [compiling, setCompiling] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteSlug, setDeleteSlug] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [previewVariant, setPreviewVariant] = React.useState<'original'>('original');
  const [previewText, setPreviewText] = React.useState("");
  const [previewHtml, setPreviewHtml] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const docxRef = React.useRef<HTMLDivElement | null>(null);
  const [docxAb, setDocxAb] = React.useState<ArrayBuffer | null>(null);
  const [inspecting, setInspecting] = React.useState(false);
  const [controls, setControls] = React.useState<Array<{ tag?: string; alias?: string; type?: string }>>([]);
  // cleaned: no separate code state; use modal
  const [codeModal, setCodeModal] = React.useState<{ title: string; code: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/templates`);
      const j = await r.json();
      setItems(Array.isArray(j?.templates) ? j.templates : []);
      // auto-select first template if none selected
      if (!selected) {
        const first = (Array.isArray(j?.templates) ? j.templates : [])[0]?.slug;
        if (first) setSelected(first);
      }
    } catch {
      setItems([]);
    } finally { setLoading(false) }
  }
  React.useEffect(() => { load(); }, []);

  async function loadPreview(sl: string, variant: 'original'|'compiled') {
    setPreviewLoading(true);
    setPreviewText("");
    setPreviewHtml(null);
    try {
      // Try docx binary preview first
      const rDoc = await fetch(`/api/templates/${encodeURIComponent(sl)}/file?variant=${variant}`);
      if (rDoc.ok && (rDoc.headers.get('content-type') || '').includes('application/vnd.openxmlformats-officedocument')) {
        const ab = await rDoc.arrayBuffer();
        setPreviewHtml('DOCX');
        setDocxAb(ab);
        return;
      }
      // Fallback to HTML/text preview
      const r = await fetch(`/api/templates/${encodeURIComponent(sl)}/preview?variant=${variant}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || r.status));
      if (j?.html) setPreviewHtml(String(j.html));
      else setPreviewText(String(j?.text || ''));
    } catch (e:any) {
      const msg = e?.message ? String(e.message) : 'Preview failed';
      toast.error(msg);
      setPreviewText('');
    } finally { setPreviewLoading(false) }
  }

  React.useEffect(() => {
    if (selected) loadPreview(selected, previewVariant);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, previewVariant]);

  // inspector removed
  React.useEffect(() => {}, [selected]);

  // Only Full Generator is supported now

  async function viewFullGen(sl: string) {
    try {
      const r = await fetch(`/api/templates/${encodeURIComponent(sl)}/fullgen`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || r.status));
      setCodeModal({ title: 'Full Document Generator (generator.full.ts)', code: String(j.code || '') });
    } catch (e:any) { toast.error(e?.message ? String(e.message) : 'Failed to load full generator') }
  }

  // Rebuild Full Generator only

  async function rebuildFullGen(sl: string) {
    try {
      const r = await fetch(`/api/templates/${encodeURIComponent(sl)}/fullgen/rebuild`, { method: 'POST' });
      if (!r.ok) throw new Error(String((await r.json().catch(()=>({})))?.error || r.status));
      toast.success('Full document generator rebuilt');
    } catch (e:any) { toast.error(e?.message ? String(e.message) : 'Failed to rebuild full generator') }
  }

  // Render DOCX when buffer and container are ready
  React.useEffect(() => {
    (async () => {
      if (previewHtml === 'DOCX' && docxAb && docxRef.current) {
        try {
          const mod = await import('docx-preview');
          const renderAsync = (mod as any).renderAsync as (buf: ArrayBuffer, el: HTMLElement, opts?: any) => Promise<void>;
          docxRef.current.innerHTML = '';
          await renderAsync(docxAb, docxRef.current as any, { className: 'docx', inWrapper: true, ignoreFonts: true });
        } catch {
          // ignore; loadPreview fallback handles errors via toast
        }
      }
    })();
  }, [previewHtml, docxAb, selected, previewVariant]);

  async function doUpload() {
    if (!file) { toast.error("Choose a file"); return; }
    try {
      setUploading(true);
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      if (slug.trim()) fd.append("slug", slug.trim());
      const r = await fetch(`/api/templates/upload`, { method: 'POST', body: fd });
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

  async function compile(sl: string) {
    try {
      setCompiling(sl);
      const r = await fetch(`/api/templates/${encodeURIComponent(sl)}/compile`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (j && (j.error || j.message)) ? String(j.error || j.message) : String(r.status);
        throw new Error(msg);
      }
      const ws = j?.usedWorkspace ? ` (Workspace: ${j.usedWorkspace})` : "";
      if (j?.info) toast.info(`${String(j.info)}${ws}`);
      else toast.success(`Compiled with AI${ws}`);
      await load();
    } catch (e:any) {
      const msg = e?.message ? String(e.message) : 'Compile failed';
      toast.error(msg);
    } finally { setCompiling(null) }
  }

  function startDelete(sl: string) {
    setDeleteSlug(sl);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteSlug) return;
    try {
      const r = await fetch(`/api/templates/${encodeURIComponent(deleteSlug)}`, { method: 'DELETE' });
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

  function selectTemplate(sl: string) {
    setSelected(sl);
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
              <Button><Icon.Upload className="h-4 w-4 mr-2"/>Upload</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Upload Template Source</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
                <Input placeholder="Slug (optional)" value={slug} onChange={(e) => setSlug(e.target.value)} />
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                <div className="text-xs text-muted-foreground">Supported: Markdown (.md), HTML (.html), Text (.txt). Compile to Handlebars with AI after upload.</div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
                <Button onClick={doUpload} disabled={!file || uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="secondary" onClick={load}><Icon.Refresh className="h-4 w-4 mr-2"/>Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4 min-h-0">
        {/* Left list */}
        <div className="col-span-12 md:col-span-4 lg:col-span-4">
          <Card className="p-4 h-[calc(100vh-220px)] overflow-y-auto">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading templates.</div>
            ) : items.length ? (
              <div className="space-y-2">
                {items.map((t) => (
                  <div key={t.slug} className={`rounded-md border bg-card/50 hover:bg-accent/10 transition px-3 py-3 ${selected===t.slug ? 'ring-1 ring-ring' : ''}`}>
                    <button className="text-left w-full" onClick={() => selectTemplate(t.slug)}>
                      <div className="font-medium">{t.name || t.slug}</div>
                      <div className="text-xs text-muted-foreground">{t.hasFullGen ? 'Compiled' : 'Not compiled'}{t.compiledAt ? ` • ${new Date(t.compiledAt).toLocaleString()}` : ''}</div>
                      <div className="text-xs text-muted-foreground">{t.slug} • {t.hasTemplate ? 'Compiled' : 'Uploaded'}{t.hasFullGen ? ' • FullGen' : ''}{t.workspaceSlug ? ` • WS ${t.workspaceSlug}` : ''}{t.updatedAt ? ` • ${new Date(t.updatedAt).toLocaleString()}` : ''}</div>
                    </button>
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => compile(t.slug)} disabled={compiling === t.slug}>
                        {compiling === t.slug ? 'Compiling...' : (t.hasFullGen ? 'Recompile' : 'Compile')}
                      </Button>
                      {t.hasFullGen ? (
                        <button className="text-xs underline text-muted-foreground" onClick={() => viewFullGen(t.slug)}>View FullGen</button>
                      ) : null}
                      <Button size="sm" variant="destructive" onClick={() => startDelete(t.slug)}>Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No templates yet. Upload one to get started.</div>
            )}
          </Card>
        </div>

        {/* Right preview */}
        <div className="col-span-12 md:col-span-8 lg:col-span-8">
          <Card className="p-4 h-[calc(100vh-220px)] flex flex-col">
            {!selected ? (
              <div className="text-sm text-muted-foreground">Select a template to preview.</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="font-medium truncate">{items.find(i=>i.slug===selected)?.name || selected}</div>
                  <div className="relative inline-flex bg-muted rounded-full p-1">
                    <div className={`absolute inset-y-1 left-1 w-full rounded-full bg-background shadow`}></div>
                    <button className={`relative z-10 w-48 text-center text-sm py-1 rounded-full`}>Original</button>
                  </div>
                </div>
                <div className="border rounded-md bg-muted/30 text-sm overflow-auto flex-1">
                  {previewLoading ? 'Loading preview...' : (
                    previewHtml === 'DOCX' ? (
                      <div className="w-full h-full overflow-auto">
                        <div className="mx-auto my-6 bg-white text-foreground shadow-sm" style={{ width: '816px', padding: '96px' }}>
                          <div ref={docxRef} className="docx" />
                        </div>
                      </div>
                    ) : previewHtml != null ? (
                      <div className="w-full h-full overflow-auto">
                        <div className="mx-auto my-6 bg-white text-foreground shadow-sm" style={{ width: '816px', padding: '96px' }}>
                          <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                        </div>
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap px-3 py-2">{previewText || 'No content'}</pre>
                    )
                  )}
                </div>
                <div className="mt-3 grid grid-cols-12 gap-3">
                  <div className="col-span-12">
                    <div className="text-sm font-medium mb-1">Actions</div>
                    <div className="border rounded-md p-3 bg-card/50 flex flex-col gap-2">
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => viewFullGen(selected!)}>View Full Generator</Button>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" onClick={() => rebuildFullGen(selected!)}>Rebuild Full Generator</Button>
                      </div>
                    </div>
                    {compiling ? (
                      <div className="w-full mt-2"><Progress indeterminate /></div>
                    ) : null}
                  </div>
                </div>
              </>
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
      <Dialog open={!!codeModal} onOpenChange={(v)=>{ if(!v) setCodeModal(null) }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle>{codeModal?.title || 'Code'}</DialogTitle></DialogHeader>
          <div className="border rounded-md bg-muted/30 px-3 py-2 h-96 overflow-auto text-sm">
            <pre className="whitespace-pre-wrap">{codeModal?.code || ''}</pre>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={()=>setCodeModal(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
