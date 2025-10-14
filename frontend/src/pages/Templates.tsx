import * as React from "react";
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose } from "../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Badge } from "../components/ui/badge";
import { Icon } from "../components/icons";
import { Progress } from "../components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { DocxPreview } from "../components/DocxPreview";
import { TemplateMetadataModal, type TemplateMetadata } from "../components/TemplateMetadataModal";
import { useTemplateMetadata } from "../contexts/TemplateMetadataContext";
import { Search, FileText as FileTextIcon, FileSpreadsheet, FileCode, CheckCircle2, AlertTriangle, Loader2, Sparkles, Copy, X, ExternalLink, Info, RefreshCw, Network, Zap } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, apiEventSource } from '../lib/api';

type TItem = { slug: string; name?: string; dir?: string; hasTemplate?: boolean; hasDocx?: boolean; hasExcel?: boolean; hasSource?: boolean; hasFullGen?: boolean; compiledAt?: string; workspaceSlug?: string; updatedAt?: string; versionCount?: number };

type CompileStatus = 'idle' | 'running' | 'success' | 'error';
type CompileState = { status: CompileStatus; startedAt?: number; finishedAt?: number; error?: string };
type CompileStateMap = Record<string, CompileState>;

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
  const [compileStates, setCompileStates] = React.useState<CompileStateMap>({});
  const updateCompileState = React.useCallback((slug: string, patch: Partial<CompileState>) => {
    setCompileStates((prev) => {
      const prevState = prev[slug] || { status: 'idle' as CompileStatus };
      const nextState = { ...prevState, ...patch };
      if (nextState.status === 'running') {
        nextState.finishedAt = undefined;
      }
      return { ...prev, [slug]: nextState };
    });
  }, []);
  const [q, setQ] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<string>("all"); // all|docx|excel|text
  const [sortBy, setSortBy] = React.useState<string>("recent"); // recent|name
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [previewContent, setPreviewContent] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewType, setPreviewType] = React.useState<'html' | 'text' | 'binary' | null>(null);
  const [previewSource, setPreviewSource] = React.useState<string | null>(null);

  // Template metadata modal state
  const [metadataModal, setMetadataModal] = React.useState<TemplateMetadata | null>(null);
  const { metadataProcessing, startTracking, setRefreshCallback } = useTemplateMetadata();
  const [templateMetadataCache, setTemplateMetadataCache] = React.useState<Map<string, boolean>>(new Map());
  
  // Template matching job state
  const [matchingJobRunning, setMatchingJobRunning] = React.useState(false);
  const [matchingJobId, setMatchingJobId] = React.useState<string | null>(null);
  const matchingPollRef = React.useRef<NodeJS.Timeout | null>(null);

  // Track if any AI operation (compile or metadata extraction) is running
  const anyCompileInFlight = Object.values(compileStates).some(s => s.status === 'running');
  const hasActiveAIOperation = anyCompileInFlight || metadataProcessing.size > 0;

  // Format relative time helper (from Customers.tsx)
  function formatRelativeTime(value?: string | number | Date): string {
    if (!value) return "-";
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      const diffMs = date.getTime() - Date.now();
      const diffSeconds = Math.round(diffMs / 1000);
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      const absSeconds = Math.abs(diffSeconds);
      if (absSeconds < 60) return rtf.format(diffSeconds, 'second');
      const diffMinutes = Math.round(diffSeconds / 60);
      if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
      const diffHours = Math.round(diffMinutes / 60);
      if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
      const diffDays = Math.round(diffHours / 24);
      if (Math.abs(diffDays) < 7) return rtf.format(diffDays, 'day');
      const diffWeeks = Math.round(diffDays / 7);
      if (Math.abs(diffWeeks) < 5) return rtf.format(diffWeeks, 'week');
      const diffMonths = Math.round(diffDays / 30);
      if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, 'month');
      const diffYears = Math.round(diffDays / 365);
      return rtf.format(diffYears, 'year');
    } catch {
      return "-";
    }
  }

  // Load template metadata
  async function loadMetadata(templateSlug: string) {
    try {
      const r = await apiFetch(`/api/templates/${encodeURIComponent(templateSlug)}/metadata`);
      const data = await r.json();
      
      // Check if metadata exists
      const hasMetadata = data.metadata && (data.metadata.templateType || data.metadata.purpose || (data.metadata.requiredDataTypes && data.metadata.requiredDataTypes.length > 0));
      setTemplateMetadataCache(prev => new Map(prev).set(templateSlug, hasMetadata));
      
      if (!hasMetadata) {
        // No metadata - trigger extraction
        await extractMetadata(templateSlug);
      } else {
        // Has metadata - show it
        setMetadataModal(data.metadata);
      }
    } catch (err) {
      console.error('Failed to load metadata:', err);
      // If error, try extraction
      await extractMetadata(templateSlug);
    }
  }

  // Trigger metadata extraction
  async function extractMetadata(templateSlug: string) {
    try {
      const r = await apiFetch(`/api/templates/${encodeURIComponent(templateSlug)}/metadata-extract`, {
        method: 'POST'
      });
      if (!r.ok) {
        throw new Error('Failed to start metadata extraction');
      }
      
      // Start tracking the metadata extraction
      startTracking(templateSlug);
      toast.success?.('Metadata extraction started');
    } catch (err) {
      console.error('Failed to extract metadata:', err);
      toast.error?.('Failed to start metadata extraction');
    }
  }


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

  async function loadPreview(slug: string) {
    // Preview is now handled by DocxPreview component
    setPreviewLoading(true);
    
    try {
      // Just fetch preview metadata to determine type
      const r = await apiFetch(`/api/templates/${encodeURIComponent(slug)}/preview`);
      if (!r.ok) {
        throw new Error('Failed to load preview');
      }
      const data = await r.json();
      
      setPreviewType(data.type || 'html');
      setPreviewSource(data.downloadUrl || null);
      setPreviewContent(data.format || data.html || data.text || null);
    } catch (e) {
      console.error('Preview load failed:', e);
      toast.error?.('Failed to load preview: ' + (e as Error).message);
      setPreviewContent(null);
      setPreviewType(null);
      setPreviewSource(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Template matching job functions
  async function startMatchingJob(forceRecalculate: boolean = false) {
    try {
      const response = await apiFetch('/api/template-matching/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceRecalculate,
          createdBy: 'templates-ui'
        })
      });

      if (!response.ok) throw new Error('Failed to start matching job');

      const data = await response.json();
      if (data.success && data.jobId) {
        setMatchingJobId(data.jobId);
        setMatchingJobRunning(true);
        toast.success(forceRecalculate ? 'Recalculating all matches...' : 'Matching new documents...');
        
        // Start polling
        pollMatchingJob(data.jobId);
      } else {
        toast.error('Failed to start matching job');
      }
    } catch (err) {
      console.error('Failed to start matching job:', err);
      toast.error('Failed to start matching job');
    }
  }

  async function pollMatchingJob(jobId: string) {
    // Clear any existing poll
    if (matchingPollRef.current) {
      clearInterval(matchingPollRef.current);
    }

    matchingPollRef.current = setInterval(async () => {
      try {
        const response = await apiFetch(`/api/template-matching/jobs/${jobId}`);
        if (!response.ok) {
          clearInterval(matchingPollRef.current!);
          matchingPollRef.current = null;
          setMatchingJobRunning(false);
          return;
        }

        const data = await response.json();
        const job = data.job;

        if (job.status === 'completed') {
          clearInterval(matchingPollRef.current!);
          matchingPollRef.current = null;
          setMatchingJobRunning(false);
          setMatchingJobId(null);
          toast.success(`Matching complete: ${job.matchedDocuments} documents matched`);
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          clearInterval(matchingPollRef.current!);
          matchingPollRef.current = null;
          setMatchingJobRunning(false);
          setMatchingJobId(null);
          toast.error(job.status === 'failed' ? `Matching failed: ${job.error || 'Unknown error'}` : 'Matching cancelled');
        }
      } catch (err) {
        console.error('Failed to poll matching job:', err);
      }
    }, 2000); // Poll every 2 seconds
  }

  // Cleanup polling on unmount
  React.useEffect(() => {
    return () => {
      if (matchingPollRef.current) {
        clearInterval(matchingPollRef.current);
      }
    };
  }, []);



  React.useEffect(() => {
    if (selectedSlug) {
      loadPreview(selectedSlug);
    } else {
      setPreviewContent(null);
    }
  }, [selectedSlug]);
  React.useEffect(() => {
    setCompileStates((prev) => {
      let changed = false;
      const next = { ...prev };
      const currentSlugs = new Set(items.map((item) => item.slug));

      for (const slug of Object.keys(next)) {
        if (!currentSlugs.has(slug)) {
          delete next[slug];
          changed = true;
        }
      }

      for (const item of items) {
        const prevState = next[item.slug];
        if (prevState?.status === 'running') continue;

        if (item.hasFullGen) {
          if (!prevState || prevState.status !== 'success') {
            next[item.slug] = { ...(prevState || {}), status: 'success', error: undefined };
            changed = true;
          }
        } else {
          if (!prevState) {
            next[item.slug] = { status: 'idle' };
            changed = true;
          } else if (prevState.status === 'success') {
            next[item.slug] = { ...prevState, status: 'idle', error: undefined };
            changed = true;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [items]);

  React.useEffect(() => { load(); }, []);

  // Set up metadata refresh callback
  React.useEffect(() => {
    setRefreshCallback(() => {
      console.log('[TEMPLATE-METADATA] Refresh callback triggered, reloading templates');
      load();
    });
    return () => setRefreshCallback(null);
  }, [setRefreshCallback]);

  // Auto-select first template when items load
  React.useEffect(() => {
    if (items.length > 0 && !selectedSlug) {
      const firstTemplate = items[0];
      setSelectedSlug(firstTemplate.slug);
      loadPreview(firstTemplate.slug);
    }
  }, [items, selectedSlug]);

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



  async function compile(sl: string) {
    try {
      if (compEsRef.current) { compEsRef.current.close(); compEsRef.current = null }
      setCompiling(sl)
      updateCompileState(sl, { status: 'running', startedAt: Date.now(), finishedAt: undefined, error: undefined })
      setCompLogs([])
      setCompSteps({})
      setCompProgress(0)
      setCompJobId(null)
      const es = apiEventSource(`/api/templates/${encodeURIComponent(sl)}/compile/stream`)
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
            updateCompileState(sl, { status: 'success', finishedAt: Date.now(), error: undefined })
            if (compEsRef.current) { compEsRef.current.close(); compEsRef.current = null }
            setCompiling(null)
            setCompProgress(100)
            setCompJobId(null)
            load()
          } else if (data?.type === 'error') {
            const errMessage = String(data.error || 'unknown')
            setCompLogs((prev) => ([...(prev || []), `error:${errMessage}`]))
            updateCompileState(sl, { status: 'error', finishedAt: Date.now(), error: errMessage })
            if (compEsRef.current) { compEsRef.current.close(); compEsRef.current = null }
            setCompiling(null)
            setCompJobId(null)
          }
        } catch { }
      }
      es.onerror = () => {
        setCompLogs((prev) => ([...(prev || []), 'error:stream']))
        updateCompileState(sl, { status: 'error', finishedAt: Date.now(), error: 'stream' })
        if (compEsRef.current) { compEsRef.current.close(); compEsRef.current = null }
        setCompiling(null)
        setCompJobId(null)
      }
    } catch {
      updateCompileState(sl, { status: 'error', finishedAt: Date.now() })
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
      const uploadedSlug = j?.slug || slug.trim();
      if (j?.warning) toast.warning?.(String(j.warning));
      toast.success(`Template uploaded${ws}${j?.hasScript ? ' • Script generated' : ''}`);
      setUploadOpen(false); setFile(null); setName(""); setSlug("");
      
      // Start tracking metadata extraction for this template
      if (uploadedSlug) {
        console.log('[TEMPLATE-UPLOAD] Starting metadata tracking for:', uploadedSlug);
        startTracking(uploadedSlug);
      }
      
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

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon.FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
              <p className="text-muted-foreground">Upload and compile templates for document generation</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => startMatchingJob(false)}
                disabled={matchingJobRunning}
              >
                {matchingJobRunning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                Match New
              </Button>
            </TooltipTrigger>
            <TooltipContent>Match documents without scores to templates</TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => startMatchingJob(true)}
                disabled={matchingJobRunning}
              >
                {matchingJobRunning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Network className="h-4 w-4 mr-2" />
                )}
                Recalculate All
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recalculate template relevance for all documents</TooltipContent>
          </Tooltip>
          
          <Button variant="secondary" onClick={load}>
            <Icon.Refresh className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger>
              <Button><Icon.Upload className="h-4 w-4 mr-2" />Upload</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Template Source</DialogTitle>
                <DialogDescription>
                  Upload template files for document generation.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Display name (optional)</label>
                  <Input placeholder="My Template" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Slug (optional)</label>
                  <Input placeholder="my-template" value={slug} onChange={(e) => setSlug(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template file</label>
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
                    <div className="text-xs mt-1 max-w-full whitespace-normal break-all">{file ? file.name : 'or drag and drop here'}</div>
                  </button>
                  <div className="text-xs text-muted-foreground">Supported: Markdown (.md), HTML (.html), Text (.txt), Word (.docx), Excel (.xlsx). Compile to Handlebars with AI after upload.</div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
                <Button onClick={doUpload} disabled={!file || uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

        </div>
      </div>

      {(!loading && items.length === 0) ? (
        <Card className="p-10 flex flex-col items-center justify-center text-center space-y-3">
          <Icon.FileText className="h-10 w-10 text-muted-foreground" />
          <div className="text-lg font-semibold">Upload your first template</div>
          <div className="text-sm text-muted-foreground">Templates are used to generate customized documents with AI assistance.</div>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger>
              <Button><Icon.Upload className="h-4 w-4 mr-2" />Upload Template</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Template</DialogTitle>
                <DialogDescription>Upload template files for document generation.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template name</label>
                  <Input 
                    placeholder="My Template" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Slug (used in URLs)</label>
                  <Input 
                    placeholder="my-template" 
                    value={slug} 
                    onChange={(e) => setSlug(e.target.value)} 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Template file</label>
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
                    <div className="text-xs mt-1 max-w-full whitespace-normal break-all">{file ? file.name : 'or drag and drop here'}</div>
                  </button>
                  <div className="text-xs text-muted-foreground">Supported: Markdown (.md), HTML (.html), Text (.txt), Word (.docx), Excel (.xlsx). Compile to Handlebars with AI after upload.</div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
                <Button onClick={doUpload} disabled={!file || uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Card>
      ) : (
      <div className="grid grid-cols-12 gap-4 min-h-0">
        {/* Cards list - left side */}
        <div className={selectedSlug ? "col-span-12 md:col-span-5" : "col-span-12"}>
          <Card className="h-[calc(100vh-220px)] flex flex-col border-0 shadow-lg overflow-hidden">
            <div className="p-4 border-b border-border/40 bg-muted/20">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input 
                    placeholder="Search templates..." 
                    value={q} 
                    onChange={(e) => setQ(e.target.value)} 
                    className="pl-9 h-9 bg-background/50 border-border/50 focus:bg-background"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="docx">Word (DOCX)</SelectItem>
                    <SelectItem value="excel">Excel (XLSX)</SelectItem>
                    <SelectItem value="text">Text/HTML/MD</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Sort by" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Recently modified</SelectItem>
                    <SelectItem value="name">Name (A–Z)</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="secondary" className="text-xs font-medium px-3 py-1 bg-primary/10 text-primary border-primary/20 shrink-0">
                  {items.length}
                </Badge>
              </div>
            </div>
            
            {loading ? (
              <div className="p-4">
                <div className="text-sm text-muted-foreground">Loading templates…</div>
              </div>
            ) : items.length ? (
              <div className="flex-1 overflow-y-auto">
                <div className="p-4 space-y-2">
                  {items
                    .filter((t) => !q || (t.name || t.slug).toLowerCase().includes(q.toLowerCase()) || t.slug.toLowerCase().includes(q.toLowerCase()))
                    .filter((t) => typeFilter === 'all' ? true : (typeFilter === 'docx' ? !!t.hasDocx : (typeFilter === 'excel' ? !!(t as any).hasExcel : !t.hasDocx && !((t as any).hasExcel))))
                    .sort((a, b) => sortBy === 'name' ? String(a.name || a.slug).localeCompare(String(b.name || b.slug)) : (new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()))
                    .map((t) => {
                      const state = compileStates[t.slug];
                      const effectiveStatus = state?.status ?? (t.hasFullGen ? 'success' : 'idle');
                      const isActiveCompile = compiling === t.slug;
                      const isCompiling = effectiveStatus === 'running' || isActiveCompile;
                      const hadError = effectiveStatus === 'error';
                      const hasCompiled = Boolean(t.hasFullGen || effectiveStatus === 'success');
                      const disableCompileButton = isCompiling || (anyCompileInFlight && !isActiveCompile) || metadataProcessing.size > 0;
                      const compileLabel = isCompiling ? 'Compiling...' : (hadError ? 'Retry compile' : (hasCompiled ? 'Recompile' : 'Compile'));
                      const compileActionLabel = isCompiling ? 'Compiling template' : (hadError ? 'Retry compile for template' : (hasCompiled ? 'Recompile template' : 'Compile template'));
                      const compileTooltip = metadataProcessing.size > 0 ? 'Metadata extraction in progress' : isCompiling ? 'Compilation running...' : (hadError ? 'Last attempt failed - try again' : (hasCompiled ? 'Generate a fresh FullGen script' : 'Create the FullGen script'));
                      
                      // Determine icon for template type
                      const TemplateIcon = t.hasDocx ? FileTextIcon : (t.hasExcel ? FileSpreadsheet : FileCode);
                      const iconWrapper = t.hasDocx ? 'bg-blue-100 text-blue-600' : (t.hasExcel ? 'bg-green-100 text-green-600' : 'bg-purple-100 text-purple-600');
                      const typeLabel = t.hasDocx ? 'Word Document' : (t.hasExcel ? 'Excel Spreadsheet' : 'Text/Code');
                      
                      return (
                        <div 
                          key={t.slug} 
                          className={`rounded-md border transition px-3 py-2 cursor-pointer ${
                            selectedSlug === t.slug 
                              ? 'bg-primary/10 border-primary/50 shadow-sm' 
                              : 'bg-card/50 hover:bg-accent/50 hover:border-accent'
                          }`}
                          onClick={() => setSelectedSlug(t.slug)}
                        >
                          <div className="flex gap-3">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-md ${iconWrapper} shrink-0`} title={typeLabel}>
                              <TemplateIcon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-col gap-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium break-words leading-snug" title={t.name || t.slug}>
                                      {t.name || t.slug}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                      <span title={t.slug}>{t.slug}</span>
                                      {t.workspaceSlug && (
                                        <span className="text-primary" title={`Workspace: ${t.workspaceSlug}`}>
                                          {t.workspaceSlug}
                                        </span>
                                      )}
                                      {t.hasFullGen ? (
                                        <span className="inline-flex items-center gap-1 text-green-600">
                                          <CheckCircle2 className="h-3 w-3" />
                                          Compiled
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 text-amber-600">
                                          <AlertTriangle className="h-3 w-3" />
                                          Not compiled
                                        </span>
                                      )}
                                      {t.updatedAt && (
                                        <span title={new Date(t.updatedAt).toLocaleString()}>
                                          {formatRelativeTime(t.updatedAt)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {/* Compile button - always visible on desktop, hidden on mobile */}
                                  <div className="hidden xl:flex items-center gap-1 sm:gap-2 shrink-0">
                                    <Tooltip>
                                      <TooltipTrigger>
                                      <Button
                                        size="icon"
                                        variant={hadError ? "outline" : "default"}
                                        className={`h-9 w-9 ${
                                          hadError ? 'border-amber-500 text-amber-700 hover:bg-amber-50' : ''
                                        } ${isCompiling ? 'opacity-80' : ''}`}
                                        aria-label={compileActionLabel}
                                        onClick={(e) => { e.stopPropagation(); compile(t.slug); }}
                                        disabled={disableCompileButton}
                                        aria-busy={isCompiling}
                                      >
                                        {isCompiling ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : hadError ? (
                                          <AlertTriangle className="h-4 w-4" />
                                        ) : hasCompiled ? (
                                          <Icon.Refresh className="h-4 w-4" />
                                        ) : (
                                          <Sparkles className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{compileTooltip}</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-9 w-9"
                                        aria-label="Open folder"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          try {
                                            const r = await apiFetch(`/api/templates/${encodeURIComponent(t.slug)}/open-folder`, { method: 'POST' });
                                            if (!r.ok) throw new Error(String(r.status));
                                            toast.success('Opened folder');
                                          } catch { toast.error('Failed to open folder') }
                                        }}
                                      >
                                        <Icon.Folder className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Open Folder</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className={`h-9 w-9 ${metadataProcessing.has(t.slug) ? 'opacity-80' : ''}`}
                                        aria-label={`View metadata for ${t.name || t.slug}`}
                                        onClick={(e) => { e.stopPropagation(); loadMetadata(t.slug); }}
                                        disabled={metadataProcessing.has(t.slug) || anyCompileInFlight}
                                      >
                                        {metadataProcessing.has(t.slug) ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : templateMetadataCache.get(t.slug) === false ? (
                                          <RefreshCw className="h-4 w-4" />
                                        ) : (
                                          <Info className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {anyCompileInFlight 
                                        ? 'Template compilation in progress'
                                        : metadataProcessing.has(t.slug) 
                                        ? 'Extracting template metadata...' 
                                        : templateMetadataCache.get(t.slug) === false
                                        ? 'Extract Metadata'
                                        : 'View Template Metadata'
                                      }
                                    </TooltipContent>
                                  </Tooltip>
                                  {t.hasFullGen && (
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-9 w-9"
                                          aria-label="View FullGen"
                                          onClick={(e) => { e.stopPropagation(); viewFullGen(t.slug); }}
                                        >
                                          <Icon.File className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>View FullGen Script</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        size="icon"
                                        variant="destructive"
                                        className="h-9 w-9"
                                        aria-label="Delete"
                                        onClick={(e) => { e.stopPropagation(); startDelete(t.slug); }}
                                      >
                                        <Icon.Trash className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete Template</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                              {/* All buttons row - visible on mobile below text */}
                              <div className="flex xl:hidden items-center gap-1 border-t pt-2">
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        size="icon"
                                        variant={hadError ? "outline" : "default"}
                                        className={`h-8 w-8 ${
                                          hadError ? 'border-amber-500 text-amber-700 hover:bg-amber-50' : ''
                                        } ${isCompiling ? 'opacity-80' : ''}`}
                                        aria-label={compileActionLabel}
                                        onClick={(e) => { e.stopPropagation(); compile(t.slug); }}
                                        disabled={disableCompileButton}
                                        aria-busy={isCompiling}
                                      >
                                        {isCompiling ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : hadError ? (
                                          <AlertTriangle className="h-4 w-4" />
                                        ) : hasCompiled ? (
                                          <Icon.Refresh className="h-4 w-4" />
                                        ) : (
                                          <Sparkles className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{compileTooltip}</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        aria-label="Open folder"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          try {
                                            const r = await apiFetch(`/api/templates/${encodeURIComponent(t.slug)}/open-folder`, { method: 'POST' });
                                            if (!r.ok) throw new Error(String(r.status));
                                            toast.success('Opened folder');
                                          } catch { toast.error('Failed to open folder') }
                                        }}
                                      >
                                        <Icon.Folder className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Open Folder</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className={`h-8 w-8 ${metadataProcessing.has(t.slug) ? 'opacity-80' : ''}`}
                                        aria-label={`View metadata for ${t.name || t.slug}`}
                                        onClick={(e) => { e.stopPropagation(); loadMetadata(t.slug); }}
                                        disabled={metadataProcessing.has(t.slug) || anyCompileInFlight}
                                      >
                                        {metadataProcessing.has(t.slug) ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : templateMetadataCache.get(t.slug) === false ? (
                                          <RefreshCw className="h-4 w-4" />
                                        ) : (
                                          <Info className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {anyCompileInFlight
                                        ? 'Template compilation in progress'
                                        : metadataProcessing.has(t.slug) 
                                        ? 'Extracting template metadata...' 
                                        : templateMetadataCache.get(t.slug) === false
                                        ? 'Extract Metadata'
                                        : 'View Template Metadata'
                                      }
                                    </TooltipContent>
                                  </Tooltip>
                                  {t.hasFullGen && (
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-8 w-8"
                                          aria-label="View FullGen"
                                          onClick={(e) => { e.stopPropagation(); viewFullGen(t.slug); }}
                                        >
                                          <Icon.File className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>View FullGen Script</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Button
                                        size="icon"
                                        variant="destructive"
                                        className="h-8 w-8"
                                        aria-label="Delete"
                                        onClick={(e) => { e.stopPropagation(); startDelete(t.slug); }}
                                      >
                                        <Icon.Trash className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete Template</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="p-4">
                <div className="text-sm text-muted-foreground">No templates yet. Upload one to get started.</div>
              </div>
            )}
          </Card>
        </div>

        {/* Preview panel - right side - always visible */}
        <div className="col-span-12 md:col-span-7">
          {selectedSlug && previewSource ? (() => {
            const selectedTemplate = items.find(t => t.slug === selectedSlug);
            const format = previewContent || 'docx';
            
            // Show DocxPreview for binary files (docx/xlsx)
            if (previewType === 'binary' && previewSource) {
              return (
                <DocxPreview
                  url={previewSource}
                  format={format}
                  displayName={selectedTemplate?.name || selectedSlug}
                  className="h-[calc(100vh-220px)]"
                  showToolbar={true}
                />
              );
            }
            
            // Show custom preview for HTML/text content
            return (
              <Card className="h-[calc(100vh-220px)] flex flex-col border-0 shadow-lg overflow-hidden">
                <div className="p-4 border-b border-border/40 bg-muted/20 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{selectedTemplate?.name || selectedSlug}</div>
                    <div className="text-xs text-muted-foreground">Template Preview</div>
                  </div>
                </div>
                <div className="flex-1 overflow-auto bg-white">
                  {previewLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-3">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
                        <div className="text-sm text-muted-foreground">Loading preview...</div>
                      </div>
                    </div>
                  ) : previewContent ? (
                    <div 
                      className="prose prose-sm max-w-none p-6"
                      dangerouslySetInnerHTML={{ __html: previewContent }}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center space-y-2 text-muted-foreground">
                        <FileTextIcon className="h-12 w-12 mx-auto opacity-50" />
                        <div className="text-sm">No preview available</div>
                        <div className="text-xs">This template may not have a previewable format</div>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })() : (
            <Card className="h-[calc(100vh-220px)] flex flex-col border-0 shadow-lg overflow-hidden">
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3 text-muted-foreground p-8">
                  <FileTextIcon className="h-16 w-16 mx-auto opacity-30" />
                  <div className="text-sm font-medium">No Template Selected</div>
                  <div className="text-xs max-w-sm">
                    {items.length === 0 
                      ? "Upload a template to get started" 
                      : "Select a template from the list to view its preview"}
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
      )}

      {/* Delete Template Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template "{deleteSlug}"?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="!bg-destructive !text-destructive-foreground hover:!bg-destructive/90 focus:!ring-destructive">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Code Modal */}
      <Dialog open={!!codeModal} onOpenChange={(v) => { if (!v) setCodeModal(null) }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{codeModal?.title || 'Code'}</DialogTitle>
            <DialogDescription>View generated code for this template.</DialogDescription>
          </DialogHeader>
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
            <DialogClose>
              <Button variant="secondary">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Metadata Modal */}
      <TemplateMetadataModal
        metadata={metadataModal}
        open={!!metadataModal}
        onOpenChange={(open) => !open && setMetadataModal(null)}
        onRetry={(templateSlug) => {
          setMetadataModal(null);
          extractMetadata(templateSlug);
        }}
      />
    </div>
  );
}



