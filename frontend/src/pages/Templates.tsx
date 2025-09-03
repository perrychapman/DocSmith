import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Icon } from "../components/icons";
import { toast } from "sonner";

type TItem = { slug: string; name?: string; hasTemplate?: boolean; hasSource?: boolean; updatedAt?: string };

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

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/templates`);
      const j = await r.json();
      setItems(Array.isArray(j?.templates) ? j.templates : []);
    } catch {
      setItems([]);
    } finally { setLoading(false) }
  }
  React.useEffect(() => { load(); }, []);

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
      toast.success("Template uploaded");
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
      if (!r.ok) throw new Error(String(r.status));
      if (j?.info) toast.info(String(j.info));
      else toast.success("Compiled with AI");
      await load();
    } catch (e:any) {
      toast.error("Compile failed");
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
      toast.success(`Template "${deleteSlug}" deleted`);
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

      <Card className="p-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading templates.</div>
        ) : items.length ? (
          <div className="space-y-2">
            {items.map((t) => (
              <div key={t.slug} className="rounded-md border bg-card/50 hover:bg-accent/10 transition px-3 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{t.name || t.slug}</div>
                  <div className="text-xs text-muted-foreground">{t.slug} • {t.hasTemplate ? 'Compiled' : 'Uploaded'}{t.updatedAt ? ` • ${new Date(t.updatedAt).toLocaleString()}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => compile(t.slug)} disabled={compiling === t.slug}>
                    {compiling === t.slug ? 'Compiling...' : 'Compile with AI'}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => startDelete(t.slug)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No templates yet. Upload one to get started.</div>
        )}
      </Card>

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
    </div>
  );
}
