import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/Button";
import { Input } from "../components/ui/input";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose } from "../components/ui/dialog";
import { Icon } from "../components/icons";
import { Maximize2, Minimize2, Search, ExternalLink, Download, FileText, FileSpreadsheet, FileCode, FileQuestion, FileType, Info, Loader2, Pin, PinOff, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "../components/ui/tooltip";
import { A, apiFetch, apiEventSource } from "../lib/api";
import WorkspaceChat from "../components/WorkspaceChat";
import { toast } from "sonner";
import { Progress } from "../components/ui/progress";
import { ScrollArea } from "../components/ui/scroll-area";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import JobsPanel from "../components/JobsPanel";
import { MetadataModal, type DocumentMetadata } from "../components/MetadataModal";
import { useMetadata } from "../contexts/MetadataContext";

type Customer = { id: number; name: string; createdAt: string };
type UploadItem = { name: string; path: string; size: number; modifiedAt: string };

const INLINE_PREVIEW_EXTENSIONS = new Set<string>(['.pdf'])


export function CustomersPage() {
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = React.useState(true);
  const [name, setName] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [loadingUploads, setLoadingUploads] = React.useState(false);
  const [generatedDocs, setGeneratedDocs] = React.useState<UploadItem[]>([]);
  const [loadingGeneratedDocs, setLoadingGeneratedDocs] = React.useState(false);
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
  const [pinningTest, setPinningTest] = React.useState<string | null>(null);
  const [pinnedDocs, setPinnedDocs] = React.useState<Set<string>>(new Set());
  const [countsLoading, setCountsLoading] = React.useState(false);
  const [generateOpen, setGenerateOpen] = React.useState(false);
  const [templates, setTemplates] = React.useState<Array<{ slug: string; name: string }>>([]);
  const [loadingTemplates, setLoadingTemplates] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<string>("");
  const [genInstructions, setGenInstructions] = React.useState<string>("");
  const [generating, setGenerating] = React.useState(false);
  const [genLogs, setGenLogs] = React.useState<string[] | null>(null);
  const genEventRef = React.useRef<EventSource | null>(null);
  const [genSteps, setGenSteps] = React.useState<Record<string, 'start' | 'ok' | 'error'>>({});
  const [genProgress, setGenProgress] = React.useState<number | null>(null);
  const [genJobId, setGenJobId] = React.useState<string | null>(null);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [genDocuments, setGenDocuments] = React.useState<Array<{ name: string; relevance: number; reasoning: string; anythingllmPath?: string }>>([]);
  const [genPinnedDocs, setGenPinnedDocs] = React.useState<Set<string>>(new Set());
  const [loadingGenDocs, setLoadingGenDocs] = React.useState(false);
  // External chat cards to display generation metadata in chat
  const [chatCards, setChatCards] = React.useState<Array<{ id: string; template?: string; jobId?: string; jobStatus?: 'running' | 'done' | 'error' | 'cancelled'; filename?: string; aiContext?: string; timestamp?: number; side?: 'user' | 'assistant' }>>([]);

  // Metadata modal state
  const [metadataModal, setMetadataModal] = React.useState<DocumentMetadata | null>(null);
  const { metadataProcessing, startTracking, setRefreshCallback } = useMetadata();
  const [uploadMetadataCache, setUploadMetadataCache] = React.useState<Map<string, boolean>>(new Map());

  // Trigger metadata extraction for uploaded document
  async function extractUploadMetadata(filename: string) {
    if (!selectedId) return;
    try {
      const r = await apiFetch(`/api/uploads/${selectedId}/metadata-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      if (!r.ok) {
        throw new Error('Failed to start metadata extraction');
      }
      
      // Start tracking the metadata extraction
      startTracking(selectedId, filename);
      toast.success('Metadata extraction started');
    } catch (err) {
      console.error('Failed to extract metadata:', err);
      toast.error('Failed to start metadata extraction');
    }
  }

  // Accepted file types for upload validation
  const [acceptedFileTypes, setAcceptedFileTypes] = React.useState<Record<string, string[]> | null>(null);

  // No localStorage persistence; cards are saved to SQL via backend
  const [panelMode, setPanelMode] = React.useState<'split' | 'chat' | 'docs'>('split');
  const [docQuery, setDocQuery] = React.useState<string>("");
  const [docsTab, setDocsTab] = React.useState('uploaded'); // 'uploaded' or 'generated'
  const rowsClass = panelMode === 'split'
    ? 'grid grid-rows-[minmax(0,2fr)_minmax(0,1fr)]'
    : (panelMode === 'chat'
      ? 'grid grid-rows-[minmax(0,1fr)_minmax(0,0fr)]'
      : 'grid grid-rows-[minmax(0,0fr)_minmax(0,1fr)]');

  // Fetch accepted file types when upload dialog opens
  React.useEffect(() => {
    if (uploadOpen && !acceptedFileTypes) {
      apiFetch('/api/anythingllm/document/accepted-file-types')
        .then(r => r.json())
        .then(data => setAcceptedFileTypes(data.types || {}))
        .catch(() => setAcceptedFileTypes({}));
    }
  }, [uploadOpen, acceptedFileTypes]);

  // Validate file against accepted types
  function isFileTypeAccepted(filename: string): { valid: boolean; message?: string } {
    if (!acceptedFileTypes) return { valid: true }; // Allow if not loaded yet
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    const allExtensions = Object.values(acceptedFileTypes).flat();
    if (allExtensions.includes(ext)) {
      return { valid: true };
    }
    return {
      valid: false,
      message: `File type "${ext}" not supported. Accepted: ${allExtensions.slice(0, 10).join(', ')}${allExtensions.length > 10 ? '...' : ''}`
    };
  }

  // Human-readable file size for document list
  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let val = bytes / 1024;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
    return `${val.toFixed(val < 10 ? 1 : 0)} ${units[idx]}`;
  }

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

  function getDocumentIconMeta(filename: string) {
    const ext = (filename?.split('.').pop() || '').toLowerCase();
    const wordExt = new Set(['doc', 'docx']);
    const excelExt = new Set(['xls', 'xlsx', 'csv']);
    const codeExt = new Set(['html', 'htm', 'xhtml']);
    const markdownExt = new Set(['md', 'markdown']);

    if (wordExt.has(ext)) {
      return { Icon: FileText, wrapper: 'bg-blue-500/10 text-blue-500', label: 'Word document' };
    }
    if (excelExt.has(ext)) {
      return { Icon: FileSpreadsheet, wrapper: 'bg-emerald-500/10 text-emerald-500', label: 'Spreadsheet' };
    }
    if (codeExt.has(ext)) {
      return { Icon: FileCode, wrapper: 'bg-orange-500/10 text-orange-500', label: 'HTML file' };
    }
    if (markdownExt.has(ext)) {
      return { Icon: FileType, wrapper: 'bg-purple-500/10 text-purple-500', label: 'Markdown file' };
    }
    return { Icon: FileQuestion, wrapper: 'bg-muted text-muted-foreground', label: 'Document' };
  }

  // Set up metadata refresh callback
  React.useEffect(() => {
    setRefreshCallback(async (customerId: number) => {
      if (customerId === selectedId) {
        console.log('[METADATA] Refresh callback triggered, reloading uploads list');
        try {
          const r = await apiFetch(`/api/uploads/${customerId}`);
          if (r.ok) {
            const data = await r.json();
            setUploads(data);
            console.log('[METADATA] Uploads list refreshed with new metadata');
          }
        } catch (err) {
          console.error('[METADATA] Failed to refresh uploads:', err);
        }
      }
    });
    return () => setRefreshCallback(null);
  }, [selectedId, setRefreshCallback]);

  React.useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/customers`);
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
        const r = await apiFetch(`/api/customers/metrics`);
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
            const r = await apiFetch(`/api/uploads/${c.id}`);
            const items: UploadItem[] = await r.json().catch(() => []);
            next[c.id] = { ...(next[c.id] || {}), docs: Array.isArray(items) ? items.length : 0 };
          } catch { next[c.id] = { ...(next[c.id] || {}), docs: 0 } }
          try {
            const ws = await apiFetch(`/api/customers/${c.id}/workspace`).then((r) => r.ok ? r.json() : Promise.reject()).catch(() => null);
            const slug = ws?.slug as string | undefined;
            if (slug) {
              const data = await A.workspaceChats(slug, 200, 'desc').catch(() => null);
              const arr = Array.isArray((data as any)?.history) ? (data as any).history : (Array.isArray((data as any)?.chats) ? (data as any).chats : (Array.isArray(data) ? (data as any) : []));
              next[c.id] = { ...(next[c.id] || {}), chats: Array.isArray(arr) ? arr.length : 0 };
            } else { next[c.id] = { ...(next[c.id] || {}), chats: 0 } }
          } catch { next[c.id] = { ...(next[c.id] || {}), chats: 0 } }
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
        if (!ignore) setCounts((prev) => ({ ...prev, [selectedId!]: { ...(prev[selectedId!] || {}), chats: count } }));
      } catch { }
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
        const r = await apiFetch(`/api/customers/${cid}/workspace`);
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
        const r = await apiFetch(`/api/uploads/${cid}`);
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

  React.useEffect(() => {
    let ignore = false;
    async function loadGeneratedDocs(cid: number) {
      setLoadingGeneratedDocs(true);
      try {
        const r = await apiFetch(`/api/documents/${cid}/files`);
        if (!r.ok) throw new Error(String(r.status));
        const data: UploadItem[] = await r.json();
        if (!ignore) setGeneratedDocs(Array.isArray(data) ? data : []);
      } catch {
        if (!ignore) setGeneratedDocs([]);
      } finally {
        if (!ignore) setLoadingGeneratedDocs(false);
      }
    }
    if (selectedId) loadGeneratedDocs(selectedId);
    else setGeneratedDocs([]);
    return () => { ignore = true };
  }, [selectedId]);

  // Load templates once when opening generate modal
  React.useEffect(() => {
    if (!generateOpen) return;
    let ignore = false;
    (async () => {
      setLoadingTemplates(true);
      try {
        const r = await apiFetch(`/api/templates`);
        const data = await r.json().catch(() => ({}));
        const list: Array<{ slug: string; name: string }> = Array.isArray(data?.templates) ? data.templates : [];
        if (!ignore) setTemplates(list);
        if (!ignore && list.length && !selectedTemplate) setSelectedTemplate(list[0].slug);
      } catch {
      } finally { if (!ignore) setLoadingTemplates(false) }
    })();
    return () => { ignore = true };
  }, [generateOpen]);

  // Load documents with relevance scores when template is selected
  React.useEffect(() => {
    if (!generateOpen || !selectedTemplate || !selectedId) {
      setGenDocuments([]);
      setGenPinnedDocs(new Set());
      return;
    }
    
    let ignore = false;
    (async () => {
      setLoadingGenDocs(true);
      try {
        // Get all uploads with metadata
        const uploadsRes = await apiFetch(`/api/uploads/${selectedId}`);
        if (!uploadsRes.ok) throw new Error('Failed to load uploads');
        const allUploads: UploadItem[] = await uploadsRes.json();
        
        // Load metadata for each upload to get relevance scores
        const docsWithRelevance = await Promise.all(
          allUploads.map(async (upload) => {
            try {
              const metaRes = await apiFetch(`/api/uploads/${selectedId}/metadata?name=${encodeURIComponent(upload.name)}`);
              if (!metaRes.ok) return null;
              const metaData = await metaRes.json();
              const metadata = metaData.metadata;
              
              if (!metadata?.extraFields?.templateRelevance) return null;
              
              const relevance = metadata.extraFields.templateRelevance.find(
                (r: any) => r.slug === selectedTemplate
              );
              
              if (!relevance) return null;
              
              return {
                name: upload.name,
                relevance: relevance.score,
                reasoning: relevance.reasoning,
                anythingllmPath: metadata.anythingllmPath
              };
            } catch {
              return null;
            }
          })
        );
        
        const validDocs = docsWithRelevance
          .filter((d): d is NonNullable<typeof d> => d !== null)
          .sort((a, b) => b.relevance - a.relevance);
        
        if (!ignore) {
          setGenDocuments(validDocs);
          // Auto-pin documents with score >= 7
          const autoPinned = new Set(
            validDocs
              .filter(d => d.relevance >= 7)
              .map(d => d.name)
          );
          setGenPinnedDocs(autoPinned);
        }
      } catch (err) {
        console.error('Failed to load document relevance:', err);
      } finally {
        if (!ignore) setLoadingGenDocs(false);
      }
    })();
    
    return () => { ignore = true };
  }, [generateOpen, selectedTemplate, selectedId]);

  async function generateDocument() {
    if (!selectedId) { toast.error("Select a customer first"); return; }
    if (!selectedTemplate) { toast.error("Choose a template"); return; }
    if (!wsSlug) { toast.error("Customer workspace not found"); return; }
    
    try {
      setGenerating(true);
      
      // Step 1: Get ALL documents in workspace and unpin them
      toast.info('Preparing workspace documents...');
      try {
        const wsRes = await apiFetch(`/api/anythingllm/workspace/${encodeURIComponent(wsSlug)}`);
        if (wsRes.ok) {
          const wsData = await wsRes.json();
          const allDocs = wsData?.workspace?.documents || [];
          
          // Unpin ALL documents first
          for (const doc of allDocs) {
            try {
              await apiFetch(`/api/anythingllm/workspace/${encodeURIComponent(wsSlug)}/update-pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ docPath: doc.docpath, pinStatus: false })
              });
            } catch (err) {
              console.error(`Failed to unpin ${doc.docpath}:`, err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch workspace documents:', err);
      }
      
      // Step 2: Pin ONLY selected documents
      const docsToPinList = genDocuments.filter(d => genPinnedDocs.has(d.name) && d.anythingllmPath);
      if (docsToPinList.length > 0) {
        toast.info(`Pinning ${docsToPinList.length} selected document(s)...`);
        for (const doc of docsToPinList) {
          try {
            await apiFetch(`/api/anythingllm/workspace/${encodeURIComponent(wsSlug)}/update-pin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ docPath: doc.anythingllmPath, pinStatus: true })
            });
            // Update UI state for document cards
            setPinnedDocs(prev => {
              const next = new Set(prev);
              next.add(doc.name);
              return next;
            });
          } catch (err) {
            console.error(`Failed to pin ${doc.name}:`, err);
          }
        }
      }
      
      // Step 2: Start generation
      setGenSteps({}); setGenProgress(0); setGenError(null);
      const extra = genInstructions && genInstructions.trim().length ? `&instructions=${encodeURIComponent(genInstructions)}` : '';
      const url = `/api/generate/stream?customerId=${encodeURIComponent(String(selectedId))}&template=${encodeURIComponent(String(selectedTemplate))}${extra}`;
      const es = apiEventSource(url);
      genEventRef.current = es;
      let fileName: string | null = null
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}')
          if (data?.type === 'log') {
            // suppress auto-opening logs
          } else if (data?.type === 'info') {
            const extras: string[] = []
            if (data.usedWorkspace) extras.push(`workspace:${String(data.usedWorkspace)}`)
            if (data.documentsDir) extras.push(`dir:${String(data.documentsDir)}`)
            if (data.templateName) extras.push(`template:${String(data.templateName)}`)
            if (data.customerName) extras.push(`customer:${String(data.customerName)}`)
            if (data.outfile) extras.push(`outfile:${String(data.outfile)}`)
            if (data.signature) extras.push(`signature:${String(data.signature)}`)
            // suppress auto-opening logs
            if (data.jobId) {
              const jid = String(data.jobId)
              setGenJobId(jid)
              // Inject a chat card for this job (running)
              setChatCards((prev) => {
                const next = prev.filter((c) => c.id !== jid)
                const card = {
                  id: jid,
                  side: 'user' as const,
                  template: selectedTemplate || undefined,
                  jobId: jid,
                  jobStatus: 'running' as const,
                  aiContext: genInstructions || undefined,
                  timestamp: Date.now()
                }
                next.push(card)
                // Save to backend
                if (wsSlug) { A.upsertGenCard({ id: jid, workspaceSlug: wsSlug, side: 'user', template: selectedTemplate || undefined, jobId: jid, jobStatus: 'running' as const, aiContext: genInstructions || undefined, timestamp: card.timestamp }).catch(() => { }) }
                return next
              })
            }
            // Close the Generate dialog once we have a job id
            try { setGenerateOpen(false) } catch { }
          } else if (data?.type === 'step') {
            const name = String(data.name || '')
            const status = (String(data.status || 'start') as 'start' | 'ok')
            const p = typeof data.progress === 'number' ? Math.max(0, Math.min(100, Math.floor(data.progress))) : null
            setGenSteps((prev) => ({ ...(prev || {}), [name]: status }))
            if (p != null) setGenProgress(p)
          } else if (data?.type === 'error') {
            const errMsg = String(data.error || 'unknown')
            // suppress auto-opening logs
            setGenError(errMsg)
            if (genJobId) {
              const jid = genJobId
              setChatCards((prev) => prev.map((c) => c.id === jid ? { ...c, jobStatus: 'error', timestamp: Date.now() } : c))
            }
            setGenSteps((prev) => {
              const order = ['resolveCustomer', 'loadTemplate', 'resolveWorkspace', 'readGenerator', 'aiUpdate', 'transpile', 'execute', 'mergeWrite']
              const next = { ...(prev || {}) } as Record<string, 'start' | 'ok' | 'error'>
              for (let i = order.length - 1; i >= 0; i--) { const s = order[i]; if (next[s] === 'start') { next[s] = 'error'; break } }
              return next
            })
            toast.error(`Generation failed: ${errMsg}`)
            if (es && typeof es.close === 'function') es.close();
            genEventRef.current = null;
            setGenerating(false);
            setGenJobId(null);
          } else if (data?.type === 'done') {
            if (data?.file?.name) fileName = String(data.file.name)
            setGenProgress(100)
            if (data?.jobId) {
              const jid = String(data.jobId)
              setChatCards((prev) => {
                const now = Date.now();
                const updated = prev.map((c) => c.id === jid ? { ...c, jobStatus: 'done' as const, filename: fileName || c.filename, timestamp: now, side: 'user' as const } : c);
                // Also append a received card announcing generation complete
                const assistantId = `${jid}-done`;
                if (!updated.find((c) => c.id === assistantId)) {
                  updated.push({ id: assistantId, side: 'assistant' as const, template: selectedTemplate || undefined, jobId: jid, jobStatus: 'done' as const, filename: fileName || undefined, timestamp: now });
                }
                // Persist both cards
                if (wsSlug) {
                  A.upsertGenCard({ id: jid, workspaceSlug: wsSlug, side: 'user', template: selectedTemplate || undefined, jobId: jid, jobStatus: 'done' as const, filename: fileName || undefined, aiContext: genInstructions || undefined, timestamp: now }).catch(() => { })
                  A.upsertGenCard({ id: assistantId, workspaceSlug: wsSlug, side: 'assistant', template: selectedTemplate || undefined, jobId: jid, jobStatus: 'done' as const, filename: fileName || undefined, timestamp: now }).catch(() => { })
                }
                return updated;
              })
            } else if (genJobId) {
              const jid = genJobId
              setChatCards((prev) => {
                const now = Date.now();
                const updated = prev.map((c) => c.id === jid ? { ...c, jobStatus: 'done' as const, filename: fileName || c.filename, timestamp: now, side: 'user' as const } : c);
                const assistantId = `${jid}-done`;
                if (!updated.find((c) => c.id === assistantId)) {
                  updated.push({ id: assistantId, side: 'assistant' as const, template: selectedTemplate || undefined, jobId: jid, jobStatus: 'done' as const, filename: fileName || undefined, timestamp: now });
                }
                if (wsSlug) {
                  A.upsertGenCard({ id: jid, workspaceSlug: wsSlug, side: 'user', template: selectedTemplate || undefined, jobId: jid, jobStatus: 'done' as const, filename: fileName || undefined, aiContext: genInstructions || undefined, timestamp: now }).catch(() => { })
                  A.upsertGenCard({ id: assistantId, workspaceSlug: wsSlug, side: 'assistant', template: selectedTemplate || undefined, jobId: jid, jobStatus: 'done' as const, filename: fileName || undefined, timestamp: now }).catch(() => { })
                }
                return updated;
              })
            }
            if (es) {
              es.close();
              genEventRef.current = null;
              setGenerating(false);
              setGenJobId(null);
            }
            // Unpin documents after successful generation
            (async () => {
              const docsToPinList = genDocuments.filter(d => genPinnedDocs.has(d.name) && d.anythingllmPath);
              for (const doc of docsToPinList) {
                try {
                  await apiFetch(`/api/anythingllm/workspace/${encodeURIComponent(wsSlug!)}/update-pin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ docPath: doc.anythingllmPath, pinStatus: false })
                  });
                  // Update UI state for document cards
                  setPinnedDocs(prev => {
                    const next = new Set(prev);
                    next.delete(doc.name);
                    return next;
                  });
                } catch (err) {
                  console.error(`Failed to unpin ${doc.name}:`, err);
                }
              }
            })();
              // Refresh uploads and generated documents
              (async () => { 
                try { 
                  const r2 = await apiFetch(`/api/uploads/${selectedId}`); 
                  const d2: UploadItem[] = await r2.json(); 
                  setUploads(Array.isArray(d2) ? d2 : []) 
                } catch { } 
              })();
              (async () => { 
                try { 
                  const r3 = await apiFetch(`/api/documents/${selectedId}`); 
                  const d3: UploadItem[] = await r3.json(); 
                  setGeneratedDocs(Array.isArray(d3) ? d3 : []) 
                } catch { } 
              })();
            toast.success('Document generated')
          }
        } catch { }
      }
      es.onerror = () => {
        // suppress auto-opening logs
        setGenError('Stream disconnected')
        if (genJobId) {
          const jid = genJobId
          const now = Date.now();
          setChatCards((prev) => prev.map((c) => c.id === jid ? { ...c, jobStatus: 'error', timestamp: now } : c))
          if (wsSlug) { A.upsertGenCard({ id: jid, workspaceSlug: wsSlug, side: 'user', template: selectedTemplate || undefined, jobId: jid, jobStatus: 'error', aiContext: genInstructions || undefined, timestamp: now }).catch(() => { }) }
        }
        // Unpin documents on error
        (async () => {
          const docsToPinList = genDocuments.filter(d => genPinnedDocs.has(d.name) && d.anythingllmPath);
          for (const doc of docsToPinList) {
            try {
              await apiFetch(`/api/anythingllm/workspace/${encodeURIComponent(wsSlug!)}/update-pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ docPath: doc.anythingllmPath, pinStatus: false })
              });
              // Update UI state for document cards
              setPinnedDocs(prev => {
                const next = new Set(prev);
                next.delete(doc.name);
                return next;
              });
            } catch (err) {
              console.error(`Failed to unpin ${doc.name}:`, err);
            }
          }
        })();
        es.close(); genEventRef.current = null; setGenerating(false); setGenJobId(null)
        toast.error('Stream disconnected')
      }
    } catch (e) {
      toast.error("Generation failed");
      setGenerating(false)
    }
  }

  // Open logs modal for a given job id
  async function openLogs(jobId: string) {
    try {
      setGenJobId(jobId);
      setGenError(null);
      setGenSteps({});
      setGenProgress(null);
      // Fetch job details
      const r = await apiFetch(`/api/generate/jobs/${encodeURIComponent(jobId)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || r.status));
      const logs: string[] = Array.isArray(j?.logs) ? j.logs : [];
      const stepsArr: Array<{ name: string; status?: 'start' | 'ok' | 'error'; startedAt?: string; endedAt?: string; durationMs?: number }> = Array.isArray(j?.steps) ? j.steps : [];
      const status = String(j?.status || '');
      setGenLogs(logs);
      const stepMap: Record<string, 'start' | 'ok' | 'error'> = {};
      for (const s of stepsArr) { if (s?.name && s?.status) stepMap[s.name] = s.status }
      setGenSteps(stepMap);
      if (status === 'done') setGenProgress(100);
      else if (status === 'running') setGenProgress(50);
      else if (status === 'error' || status === 'cancelled') { setGenProgress(null); setGenError(status) }
    } catch (e: any) {
      setGenLogs([`error:${String(e?.message || e)}`]);
      setGenError(String(e?.message || e));
    }
  }

  // Live refresh uploads list for the selected customer
  React.useEffect(() => {
    if (!selectedId) return;
    let ignore = false;
    let timer: any;
    async function refresh() {
      try {
        const r = await apiFetch(`/api/uploads/${selectedId}`);
        if (!r.ok) throw new Error(String(r.status));
        const data: UploadItem[] = await r.json();
        if (!ignore) setUploads(Array.isArray(data) ? data : []);
      } catch { }
      if (!ignore) timer = setTimeout(refresh, 15000);
    }
    refresh();
    return () => { ignore = true; if (timer) clearTimeout(timer); };
  }, [selectedId]);

  async function add() {
    const n = name.trim();
    if (!n) return;
    try {
      await apiFetch(`/api/customers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }) });
      toast.success("Customer added");
      setName("");
      const r = await apiFetch(`/api/customers`);
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
      const r = await apiFetch(`/api/uploads/${selectedId}`, { method: "POST", body: fd });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(r.status));
      
      // Start tracking metadata extraction for this file
      const uploadedFilename = (json as any)?.file?.name || file.name;
      console.log('[UPLOAD] Starting metadata tracking for:', uploadedFilename);
      startTracking(selectedId, uploadedFilename);
      
      // refresh list
      const r2 = await apiFetch(`/api/uploads/${selectedId}`);
      const d2: UploadItem[] = await r2.json();
      setUploads(d2);
      setFile(null);
      if ((json as any)?.embeddingWarning) {
        toast.warning?.((json as any).embeddingWarning) ?? toast.success("Uploaded; embedding may still be processing");
      } else {
        // Treat completion of the request as embed completion signal
        if (toastId) (toast as any).success("Embedding completed", { id: toastId });
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
      const r = await apiFetch(`/api/uploads/${selectedId}?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(r.status));
      // refresh list
      const r2 = await apiFetch(`/api/uploads/${selectedId}`);
      const d2: UploadItem[] = await r2.json();
      setUploads(d2);
      const removed = Array.isArray((json as any)?.removedNames) ? (json as any).removedNames : [];
      if (removed.length) toast.success(`Removed ${removed.length} document${removed.length > 1 ? 's' : ''}`);
      if ((json as any)?.documentsWarning) toast.warning?.((json as any).documentsWarning);
      if (loadingId && (toast as any).success) (toast as any).success("Removed", { id: loadingId });
      else toast.success("Removed");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(null);
    }
  }

  async function togglePinDocument(name: string) {
    if (!selectedId || !wsSlug) return;
    const isPinned = pinnedDocs.has(name);
    
    try {
      setPinningTest(name);
      
      // Get metadata to find anythingllmPath
      const metaRes = await apiFetch(`/api/uploads/${selectedId}/metadata?name=${encodeURIComponent(name)}`);
      if (!metaRes.ok) throw new Error('Failed to load metadata');
      const metaData = await metaRes.json();
      const anythingllmPath = metaData.metadata?.anythingllmPath;
      
      if (!anythingllmPath) {
        toast.error('Document missing AnythingLLM path - re-upload to fix');
        return;
      }
      
      // Pin or unpin the document
      const res = await apiFetch(`/api/anythingllm/workspace/${encodeURIComponent(wsSlug)}/update-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docPath: anythingllmPath, pinStatus: !isPinned })
      });
      
      if (!res.ok) throw new Error(`${isPinned ? 'Unpin' : 'Pin'} failed`);
      
      // Update state
      setPinnedDocs(prev => {
        const next = new Set(prev);
        if (isPinned) {
          next.delete(name);
        } else {
          next.add(name);
        }
        return next;
      });
      
      toast.success(`${isPinned ? 'Unpinned' : 'Pinned'}: ${anythingllmPath}`);
    } catch (err: any) {
      toast.error(`${isPinned ? 'Unpin' : 'Pin'} failed: ${err.message}`);
      console.error('Pin toggle error:', err);
    } finally {
      setPinningTest(null);
    }
  }


  async function openCustomerFile(type: 'uploaded' | 'generated', fileName: string) {
    if (!selectedId || !fileName) return
    const base = type === 'uploaded' ? '/api/uploads' : '/api/documents'
    const openUrl = `${base}/${selectedId}/open-file?name=${encodeURIComponent(fileName)}`
    const downloadUrl = `${base}/${selectedId}/file?name=${encodeURIComponent(fileName)}`
    try {
      const response = await apiFetch(openUrl, { method: 'POST' })
      const payload = await response.json().catch(() => null)
      
      // Handle security/validation errors (403 Forbidden)
      if (response.status === 403) {
        const reason = (payload as any)?.reason || 'File type not allowed for security reasons'
        const extension = (payload as any)?.extension || ''
        toast.error?.(`Security: ${reason}`)
        console.warn(`Blocked file open attempt: ${fileName} (${extension})`)
        return
      }
      
      if (!response.ok) throw new Error(String(response.status))
      const targetPath = (payload as any)?.path
      const extension = typeof (payload as any)?.extension === 'string' ? String((payload as any).extension).toLowerCase() : undefined
      const fallbackExt = (() => {
        const parts = fileName.split('.')
        if (parts.length <= 1) return undefined
        const ext = parts.pop()?.toLowerCase()
        return ext ? `.${ext}` : undefined
      })()
      const effectiveExt = extension || fallbackExt || ''

      if (targetPath && window.electronAPI?.openPath) {
        const result = await window.electronAPI.openPath(targetPath).catch(() => ({ success: false }))
        if (result && result.success === false) {
          throw new Error(('error' in result ? result.error : undefined) || 'Failed to open path via Electron')
        }
        toast.success?.('Opened in default app')
        return
      }
      if (effectiveExt && INLINE_PREVIEW_EXTENSIONS.has(effectiveExt)) {
        window.open(downloadUrl, '_blank', 'noopener,noreferrer')
        toast.success?.('Opened in new tab')
        return
      }

      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = fileName
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      toast.success?.('Download started')
    } catch (error) {
      console.error(error)
      toast.error?.('Failed to open file')
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
      const r = await apiFetch(url, { method: "DELETE" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(r.status));
      if ((body as any)?.documentsWarning) toast.warning?.((body as any).documentsWarning);
      if ((body as any)?.workspaceWarning) toast.warning?.((body as any).workspaceWarning);
      if (loadingId && (toast as any).success) (toast as any).success("Customer deleted", { id: loadingId });
      else toast.success("Customer deleted");
      setDeleteOpen(false);
      // refresh customers
      const rr = await apiFetch(`/api/customers`);
      const data: Customer[] = await rr.json();
      setCustomers(data);
      // adjust selection
      if (selectedId === deleteId) {
        const next = data[0]?.id ?? null;
        setSelectedId(next);
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

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-primary/10 text-primary flex-shrink-0">
              <Icon.Users className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">Customers</h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">Manage your customers and their documents</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="secondary" size="sm" className="flex-1 sm:flex-initial text-xs sm:text-sm" onClick={() => { (async () => { setLoadingCustomers(true); try { const r = await apiFetch(`/api/customers`); const data: Customer[] = await r.json(); setCustomers(data); } catch { } finally { setLoadingCustomers(false); } })(); }}><Icon.Refresh className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />Refresh</Button>
        </div>
      </div>

      {(!loadingCustomers && customers.length === 0) ? (
        <Card className="p-6 sm:p-10 flex flex-col items-center justify-center text-center space-y-3">
          <Icon.Folder className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground" />
          <div className="text-base sm:text-lg font-semibold">Add your first customer</div>
          <div className="text-xs sm:text-sm text-muted-foreground">Create a customer to start chatting and uploading documents.</div>
          <div className="flex flex-col sm:flex-row items-center gap-2 w-full max-w-md">
            <Input placeholder="Customer name" className="text-sm" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <Button onClick={add} size="sm" className="w-full sm:w-auto text-sm"><Icon.Plus className="h-4 w-4 mr-2" />Add</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 min-h-0">
          {/* Left: Customers list full-height */}
          <div className="lg:col-span-4 xl:col-span-3">
            <div className="lg:sticky lg:top-0">
              <Card className="h-[400px] sm:h-[500px] lg:h-[calc(100vh-220px)] flex flex-col border-0 shadow-lg overflow-hidden">
                <div className="p-3 sm:p-4 border-b border-border/40 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-medium text-foreground">Customers</span>
                    <Badge variant="secondary" className="text-xs font-medium px-2 sm:px-3 py-0.5 sm:py-1 bg-primary/10 text-primary border-primary/20 shrink-0">
                      {customers.length}
                    </Badge>
                  </div>
                </div>
                <div className="p-3 sm:p-4 overflow-y-auto flex-1">
                  {/* Add form in panel */}
                  {customers.length > 0 && (
                    <div className="flex flex-col sm:flex-row items-center gap-2 mb-3">
                      <Input
                        placeholder="Customer name"
                        className="text-sm"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") add();
                        }}
                      />
                      <Button onClick={add} size="sm" className="w-full sm:w-auto text-sm">
                        <Icon.Plus className="h-4 w-4 mr-2" />
                        Add
                      </Button>
                    </div>
                  )}

                  {loadingCustomers ? (
                    <div className="text-muted-foreground text-xs sm:text-sm">Loading...</div>
                  ) : customers.length ? (
                    <div className="space-y-1.5 sm:space-y-2">
                      {customers.map((c) => (
                        <div
                          key={c.id}
                          role="button"
                          tabIndex={0}
                          className={
                            "group relative rounded-lg border p-2 sm:p-3 transition-all duration-200 cursor-pointer hover:shadow-md " +
                            (selectedId === c.id 
                              ? "bg-primary/10 border-primary/50 shadow-sm" 
                              : "hover:bg-accent/50 hover:border-accent")
                          }
                          onClick={() => setSelectedId(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") setSelectedId(c.id);
                          }}
                          title={new Date(c.createdAt).toLocaleString()}
                        >
                          {/* Selection indicator */}
                          {selectedId === c.id && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 sm:w-1 h-6 sm:h-8 bg-primary rounded-r" />
                          )}
                          
                          {/* Left: name + counts */}
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm sm:text-base font-medium truncate">{c.name}</div>
                              {counts[c.id]?.docs == null && counts[c.id]?.chats == null ? (
                                <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5">
                                  <div className="h-2 w-12 sm:w-16 rounded bg-muted animate-pulse" />
                                  <div className="h-2 w-12 sm:w-16 rounded bg-muted animate-pulse" />
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">
                                  {(() => {
                                    const d = counts[c.id]?.docs;
                                    const cm = counts[c.id]?.chats;
                                    const dText = d == null ? "… docs" : `${d} doc${d === 1 ? "" : "s"}`;
                                    const cText = cm == null ? "… chats" : `${cm} chat${cm === 1 ? "" : "s"}`;
                                    return `${dText} • ${cText}`;
                                  })()}
                                </div>
                              )}
                            </div>

                            {/* Right: actions (delete) */}
                            <div className="opacity-60 group-hover:opacity-100 transition-opacity duration-200 ml-2 flex items-center gap-1">
                              <Tooltip>
                                <TooltipTrigger>
                                  <Button
                                    size="icon"
                                    variant="destructive"
                                    disabled={deleting === c.name}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      startDelete(c);
                                    }}
                                    aria-label={`Delete ${c.name}`}
                                    title={`Delete ${c.name}`}
                                    className="h-7 w-7 sm:h-9 sm:w-9"
                                  >
                                    {deleting === c.name ? "." : <Icon.Trash className="h-3 w-3 sm:h-4 sm:w-4" />}
                                  </Button>
                                </TooltipTrigger>
                              </Tooltip>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-xs sm:text-sm">No customers yet.</div>
                  )}
                </div>
              </Card>
            </div>
          </div>




          {/* Right: Chat and Documents with smooth expand/collapse */}
          <div
            className={`lg:col-span-8 xl:col-span-9 ${rowsClass} gap-2 sm:gap-3 h-[500px] sm:h-[600px] lg:h-[calc(100vh-220px)] min-h-0`}
            style={{
              transition: 'grid-template-rows 300ms ease',
              gridTemplateRows: panelMode === 'split'
                ? 'minmax(0,2fr) minmax(0,1fr)'
                : (panelMode === 'chat'
                  ? 'minmax(0,1fr) minmax(0,0fr)'
                  : 'minmax(0,0fr) minmax(0,1fr)')
            }}
          >
            {/* AI Chat */}
            <div className="h-full min-h-0 overflow-hidden transition-all duration-300 ease-in-out">

              {panelMode === 'docs' ? null : (!selectedId ? (
                <Card className="p-4 text-sm text-muted-foreground h-full">Select a customer to open chat.</Card>
              ) : wsLoading ? (
                <Card className="p-4 text-sm text-muted-foreground h-full">Resolving workspace…</Card>
              ) : wsSlug ? (
                <WorkspaceChat
                  slug={wsSlug}
                  className="h-full"
                  onOpenLogs={openLogs}
                  onOpenGenerate={() => { if (selectedId) setGenerateOpen(true) }}
                  externalCards={chatCards}
                  headerActions={(
                    <>
                      <Dialog>
                        <Tooltip>
                          <TooltipTrigger>
                            <DialogTrigger asChild>
                              <Button size="icon" variant="ghost" aria-label="Recent jobs" title="Recent jobs">
                                <Icon.History className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                          </TooltipTrigger>
                        </Tooltip>
                        <DialogContent className="w-[95vw] sm:!max-w-6xl">
                          <DialogHeader>
                            <DialogTitle>Recent Generation Jobs</DialogTitle>
                            <DialogDescription>View recent document generation runs and their logs.</DialogDescription>
                          </DialogHeader>
                          <div className="h-[70vh] min-h-[480px]">
                            <JobsPanel customerId={selectedId || undefined} />
                          </div>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="secondary">Close</Button>
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <Tooltip>
                        <TooltipTrigger>
                          <Button size="icon" variant="ghost" onClick={() => setPanelMode(panelMode === 'chat' ? 'split' : 'chat')} aria-label={panelMode === 'chat' ? 'Collapse chat' : 'Expand chat'}>
                            {panelMode === 'chat' ? (<Minimize2 className="h-4 w-4" />) : (<Maximize2 className="h-4 w-4" />)}
                          </Button>
                        </TooltipTrigger>
                      </Tooltip>
                    </>
                  )}
                />
              ) : (
                <Card className="p-4 text-sm text-muted-foreground h-full">No workspace found for this customer.</Card>
              ))}
            </div>

            {/* Documents */}
            <Card className="h-full min-h-0 flex flex-col border-0 shadow-lg overflow-hidden">
              <Tabs value={docsTab} onValueChange={setDocsTab} className="h-full min-h-0 flex flex-col">
                <div className="p-4 border-b border-border/40 bg-muted/20">
                  <div className="flex items-center gap-3">
                    <TabsList className="inline-flex h-10 items-center justify-start rounded-md bg-muted p-1 text-muted-foreground">
                      <TabsTrigger value="uploaded">Uploaded</TabsTrigger>
                      <TabsTrigger value="generated">Generated</TabsTrigger>
                    </TabsList>
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder={docsTab === 'uploaded' ? 'Search uploaded documents...' : 'Search generated documents...'}
                        value={docQuery}
                        onChange={(e) => setDocQuery(e.target.value)}
                        className="pl-9 h-9 bg-background/50 border-border/50 focus:bg-background"
                      />
                    </div>
                    
                    {/* Context-aware action buttons */}
                    {docsTab === 'uploaded' && (
                      <>
                        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                          <Tooltip>
                            <TooltipTrigger>
                              <DialogTrigger asChild>
                                <Button disabled={!selectedId} size="icon" variant="ghost" aria-label="Upload document">
                                  <Icon.Upload className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                            </TooltipTrigger>
                          </Tooltip>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Upload Document</DialogTitle>
                            <DialogDescription>
                              Attach a file to this customer's workspace.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="text-sm text-muted-foreground">Click the area below to attach a file, or drag and drop.</div>
                              {acceptedFileTypes && (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                                      <FileType className="h-3 w-3 mr-1" />
                                      View all formats
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-2xl">
                                    <DialogHeader>
                                      <DialogTitle>Accepted File Formats</DialogTitle>
                                      <DialogDescription>
                                        These file types can be uploaded to AnythingLLM workspaces
                                      </DialogDescription>
                                    </DialogHeader>
                                    <ScrollArea className="max-h-[400px] pr-4">
                                      <div className="space-y-3">
                                        {Object.entries(acceptedFileTypes).map(([mimeType, extensions]) => (
                                          <div key={mimeType} className="space-y-1">
                                            <div className="text-sm font-medium">{extensions.join(', ')}</div>
                                            <div className="text-xs text-muted-foreground">{mimeType}</div>
                                          </div>
                                        ))}
                                      </div>
                                    </ScrollArea>
                                  </DialogContent>
                                </Dialog>
                              )}
                            </div>
                            <input
                              ref={fileInputRef}
                              type="file"
                              className="hidden"
                              disabled={uploading}
                              onChange={(e) => {
                                const selectedFile = e.target.files?.[0] || null;
                                if (selectedFile) {
                                  const validation = isFileTypeAccepted(selectedFile.name);
                                  if (!validation.valid) {
                                    toast.error(validation.message || 'File type not supported');
                                    e.target.value = ''; // Clear input
                                    return;
                                  }
                                }
                                setFile(selectedFile);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              onDrop={(e) => {
                                e.preventDefault(); e.stopPropagation();
                                const f = e.dataTransfer?.files?.[0];
                                if (f) {
                                  const validation = isFileTypeAccepted(f.name);
                                  if (!validation.valid) {
                                    toast.error(validation.message || 'File type not supported');
                                    return;
                                  }
                                  setFile(f);
                                }
                              }}
                              disabled={uploading}
                              className="w-full rounded-md border border-dashed p-6 text-center hover:bg-accent/40 transition flex flex-col items-center justify-center text-muted-foreground"
                            >
                              <Icon.Upload className="h-6 w-6 mb-1" />
                              <div className="font-medium">{file ? 'Change selected file' : 'Click to select a file'}</div>
                              <div className="text-xs mt-1 max-w-full whitespace-normal break-all">{file ? file.name : 'or drag and drop here'}</div>
                            </button>
                            {uploading && (
                              <div className="text-xs text-muted-foreground">{embeddingMsg || "Processing..."}</div>
                            )}
                          </div>
                          <DialogFooter>
                            <Button variant="secondary" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
                            <Button onClick={uploadFile} disabled={!selectedId || !file || uploading} aria-label="Confirm upload">
                              {uploading ? "Uploading..." : (<><Icon.Upload className="h-4 w-4 mr-2" />Upload</>)}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      {/* Open uploads folder */}
                      <Tooltip>
                        <TooltipTrigger>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Open uploads folder"
                            disabled={!selectedId}
                            onClick={async () => {
                              if (!selectedId) return;
                              try {
                                const r = await apiFetch(`/api/uploads/${selectedId}/open-folder`, { method: 'POST' });
                                if (!r.ok) throw new Error(String(r.status));
                                toast.success?.('Opened folder');
                              } catch {
                                toast.error?.('Failed to open folder');
                              }
                            }}
                          >
                            <Icon.Folder className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                      </Tooltip>
                    </>
                  )}
                  
                  {docsTab === 'generated' && (
                    <>
                      <Tooltip>
                        <TooltipTrigger>
                          <Button disabled={!selectedId} size="icon" variant="ghost" aria-label="Generate document" onClick={() => setGenerateOpen(true)}>
                            <Icon.FileText className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                      </Tooltip>
                      {/* Open documents folder for generated docs */}
                      <Tooltip>
                        <TooltipTrigger>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Open documents folder"
                            disabled={!selectedId}
                            onClick={async () => {
                              if (!selectedId) return;
                              try {
                                const r = await apiFetch(`/api/documents/${selectedId}/open-folder`, { method: 'POST' });
                                if (!r.ok) throw new Error(String(r.status));
                                toast.success?.('Opened folder');
                              } catch {
                                toast.error?.('Failed to open folder');
                              }
                            }}
                          >
                            <Icon.Folder className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                      </Tooltip>
                    </>
                  )}
                  
                  {/* Expand/Collapse Documents - right most */}
                  <Tooltip>
                    <TooltipTrigger>
                      <Button size="icon" variant="ghost" onClick={() => setPanelMode(panelMode === 'docs' ? 'split' : 'docs')} aria-label={panelMode === 'docs' ? 'Collapse documents' : 'Expand documents'}>
                        {panelMode === 'docs' ? (<Minimize2 className="h-4 w-4" />) : (<Maximize2 className="h-4 w-4" />)}
                      </Button>
                    </TooltipTrigger>
                  </Tooltip>
                  </div>
                </div>

                {/* Tab Content */}
                <TabsContent value="uploaded" className="flex flex-col flex-1 min-h-0 mt-0 p-0 overflow-hidden data-[state=inactive]:hidden">
                  {!selectedId ? (
                    <div className="p-4">
                      <div className="text-sm text-muted-foreground">Select a customer to view uploaded documents.</div>
                    </div>
                  ) : loadingUploads ? (
                    <div className="p-4">
                      <div className="text-sm text-muted-foreground">Loading uploaded documents.</div>
                    </div>
                  ) : (docQuery.trim() ? uploads.filter((u) => u.name.toLowerCase().includes(docQuery.trim().toLowerCase())).length : uploads.length) ? (
                    <ScrollArea className="flex-1 min-h-0 h-full">
                      <div className="px-4 pb-4 space-y-2">
                        {(docQuery.trim() ? uploads.filter((u) => u.name.toLowerCase().includes(docQuery.trim().toLowerCase())) : uploads).map((u, idx) => {
                          const { Icon: DocIcon, wrapper, label } = getDocumentIconMeta(u.name);
                          return (
                          <div key={idx} className="rounded-md border bg-card/50 transition px-3 py-2">
                            <div className="flex gap-3">
                              <div className={`flex h-8 w-8 items-center justify-center rounded-md ${wrapper} shrink-0`} title={label}>
                                <DocIcon className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.preventDefault(); openCustomerFile('uploaded', u.name); }}
                                      title={u.name}
                                      className="font-medium hover:underline break-words leading-snug block text-left"
                                    >
                                      {u.name}
                                    </button>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                      <span>{formatBytes(u.size)}</span>
                                      <span title={new Date(u.modifiedAt).toLocaleString()}>{formatRelativeTime(u.modifiedAt)}</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                    {/* Metadata Button */}
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Button 
                                          size="icon" 
                                          variant="ghost" 
                                          className="h-9 w-9" 
                                          aria-label={`View metadata for ${u.name}`}
                                          disabled={metadataProcessing.has(u.name)}
                                          onClick={async () => {
                                            if (!selectedId) return;
                                            try {
                                              const r = await apiFetch(`/api/uploads/${selectedId}/metadata?name=${encodeURIComponent(u.name)}`);
                                              const data = await r.json();
                                              
                                              // Check if metadata exists
                                              const hasMetadata = data.metadata && (data.metadata.documentType || data.metadata.purpose || (data.metadata.keyTopics && data.metadata.keyTopics.length > 0));
                                              setUploadMetadataCache(prev => new Map(prev).set(u.name, hasMetadata));
                                              
                                              if (!hasMetadata) {
                                                // No metadata - trigger extraction
                                                await extractUploadMetadata(u.name);
                                              } else {
                                                // Has metadata - show it
                                                setMetadataModal(data.metadata || null);
                                              }
                                            } catch (err) {
                                              console.error('Failed to load metadata:', err);
                                              // If error, try extraction
                                              await extractUploadMetadata(u.name);
                                            }
                                          }}
                                        >
                                          {metadataProcessing.has(u.name) ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : uploadMetadataCache.get(u.name) === false ? (
                                            <RefreshCw className="h-4 w-4" />
                                          ) : (
                                            <Info className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {metadataProcessing.has(u.name) 
                                          ? 'Extracting metadata...' 
                                          : uploadMetadataCache.get(u.name) === false
                                          ? 'Extract Metadata'
                                          : 'View Metadata'
                                        }
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Download ${u.name}`} onClick={() => { const a = document.createElement('a'); a.href = `/api/uploads/${selectedId}/file?name=${encodeURIComponent(u.name)}`; a.download = u.name; document.body.appendChild(a); a.click(); a.remove(); }}>
                                          <Download className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Download</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Button 
                                          size="icon" 
                                          variant={pinnedDocs.has(u.name) ? "default" : "outline"}
                                          className="h-9 w-9" 
                                          disabled={pinningTest === u.name || !wsSlug}
                                          onClick={() => togglePinDocument(u.name)} 
                                          aria-label={`${pinnedDocs.has(u.name) ? 'Unpin' : 'Pin'} ${u.name}`}
                                        >
                                          {pinningTest === u.name ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Pin className={`h-4 w-4 ${pinnedDocs.has(u.name) ? 'fill-current' : ''}`} />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>{pinnedDocs.has(u.name) ? 'Unpin' : 'Pin'} Document</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Button size="icon" variant="destructive" className="h-9 w-9" disabled={uploading || deleting === u.name} onClick={() => deleteUpload(u.name)} aria-label={`Delete ${u.name}`}>
                                          {deleting === u.name ? '.' : <Icon.Trash className="h-4 w-4" />}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Delete</TooltipContent>
                                    </Tooltip>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                        })}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="p-4">
                      <div className="text-muted-foreground text-sm">{docQuery.trim() ? 'No matching uploaded documents.' : 'No uploaded documents yet for this customer.'}</div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="generated" className="flex flex-col flex-1 min-h-0 mt-0 p-0 overflow-hidden data-[state=inactive]:hidden">
                  {!selectedId ? (
                    <div className="p-4">
                      <div className="text-sm text-muted-foreground">Select a customer to view generated documents.</div>
                    </div>
                  ) : loadingGeneratedDocs ? (
                    <div className="p-4">
                      <div className="text-sm text-muted-foreground">Loading generated documents.</div>
                    </div>
                  ) : (docQuery.trim() ? generatedDocs.filter((d) => d.name.toLowerCase().includes(docQuery.trim().toLowerCase())).length : generatedDocs.length) ? (
                    <ScrollArea className="flex-1 min-h-0 h-full">
                      <div className="px-4 pb-4 space-y-2">
                        {(docQuery.trim() ? generatedDocs.filter((d) => d.name.toLowerCase().includes(docQuery.trim().toLowerCase())) : generatedDocs).map((d, idx) => {
                          const { Icon: DocIcon, wrapper, label } = getDocumentIconMeta(d.name);
                          return (
                          <div key={idx} className="rounded-md border bg-card/50 transition px-3 py-2">
                            <div className="flex gap-3">
                              <div className={`flex h-8 w-8 items-center justify-center rounded-md ${wrapper} shrink-0`} title={label}>
                                <DocIcon className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.preventDefault(); openCustomerFile('generated', d.name); }}
                                      title={d.name}
                                      className="font-medium hover:underline break-words leading-snug block text-left"
                                    >
                                      {d.name}
                                    </button>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                      <span>{formatBytes(d.size)}</span>
                                      <span title={new Date(d.modifiedAt).toLocaleString()}>{formatRelativeTime(d.modifiedAt)}</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Download ${d.name}`} onClick={() => { const a = document.createElement('a'); a.href = `/api/documents/${selectedId}/file?name=${encodeURIComponent(d.name)}`; a.download = d.name; document.body.appendChild(a); a.click(); a.remove(); }}>
                                          <Download className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Download</TooltipContent>
                                    </Tooltip>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                        })}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="p-4">
                      <div className="text-muted-foreground text-sm">{docQuery.trim() ? 'No matching generated documents.' : 'No generated documents yet for this customer.'}</div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </div>
      )}

      {/* Delete Customer Confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="w-[95vw] sm:max-w-md">
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

      {/* Generate Document Dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate Document</DialogTitle>
            <DialogDescription>
              Select template and documents to include in generation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Template</label>
              <select className="mt-1 w-full border rounded-md h-9 px-2 bg-background" value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)} disabled={loadingTemplates || generating}>
                {loadingTemplates ? <option>Loading templates...</option> : (
                  templates.length ? templates.map((t) => (
                    <option key={t.slug} value={t.slug}>{t.name || t.slug}</option>
                  )) : <option value="">No templates found</option>
                )}
              </select>
            </div>
            
            {/* Document selection with relevance scores */}
            {selectedTemplate && (
              <div>
                <label className="text-sm font-medium">
                  Documents to Include ({genPinnedDocs.size} selected)
                </label>
                <div className="mt-2 border rounded-md max-h-[280px] overflow-y-auto">
                  {loadingGenDocs ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      Loading document relevance scores...
                    </div>
                  ) : genDocuments.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No documents with metadata found for this template
                    </div>
                  ) : (
                    <div className="divide-y">
                      {genDocuments.map((doc) => {
                        const isPinned = genPinnedDocs.has(doc.name);
                        const scoreColor = doc.relevance >= 8 ? 'text-green-600' : doc.relevance >= 6 ? 'text-yellow-600' : 'text-gray-500';
                        
                        return (
                          <div key={doc.name} className="p-3 hover:bg-muted/50 transition">
                            <div className="flex items-start gap-3">
                              <Button
                                size="icon"
                                variant={isPinned ? "default" : "outline"}
                                className="h-8 w-8 shrink-0 mt-0.5"
                                onClick={() => {
                                  setGenPinnedDocs(prev => {
                                    const next = new Set(prev);
                                    if (isPinned) next.delete(doc.name);
                                    else next.add(doc.name);
                                    return next;
                                  });
                                }}
                                disabled={generating}
                              >
                                <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-current' : ''}`} />
                              </Button>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium truncate">{doc.name}</span>
                                  <Badge variant="outline" className={`text-xs shrink-0 ${scoreColor}`}>
                                    {doc.relevance.toFixed(1)}/10
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {doc.reasoning}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div>
              <label className="text-sm font-medium">Additional Instructions (optional)</label>
              <Textarea
                className="mt-1 w-full"
                rows={3}
                placeholder="e.g., focus on Q3 data, keep it concise, etc."
                value={genInstructions}
                onChange={(e) => setGenInstructions(e.target.value)}
                disabled={generating}
              />
            </div>
            {generating ? (
              <div className="pt-2"><Progress indeterminate /></div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setGenerateOpen(false)} disabled={generating}>Cancel</Button>
            <Button onClick={generateDocument} disabled={!selectedId || !selectedTemplate || generating || genPinnedDocs.size === 0} aria-label="Confirm generate">
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generation Logs */}
      <Dialog open={!!genLogs} onOpenChange={(v) => { if (!v) { setGenLogs(null); setGenSteps({}); setGenProgress(null); setGenJobId(null); setGenError(null) } }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Generation Logs</DialogTitle>
            <DialogDescription>Live status from the generator.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {genError ? (
              <div className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm">{genError}</div>
            ) : null}
            <div>
              {typeof genProgress === 'number' ? (
                <div className="mb-2"><Progress value={genProgress} /></div>
              ) : (
                <div className="mb-2"><Progress indeterminate /></div>
              )}
              <div className="text-xs text-muted-foreground">{generating ? 'Running...' : (genProgress === 100 ? 'Completed' : (genError ? 'Failed' : 'Idle'))}</div>
            </div>
            <div className="border rounded-md bg-muted/30 px-3 py-2 h-40 overflow-hidden text-sm">
              <ScrollArea className="h-full pr-2">
                <ul className="space-y-1">
                  {['resolveCustomer', 'loadTemplate', 'resolveWorkspace', 'readGenerator', 'aiUpdate', 'transpile', 'execute', 'mergeWrite'].map((s) => {
                    const st = genSteps[s]
                    const label = s.replace(/([A-Z])/g, ' $1')
                    let badge
                    if (st === 'ok') {
                      badge = (
                        <Badge variant="outline" className="border-success text-success bg-success/10 flex items-center gap-1">
                          <Icon.Check className="h-3.5 w-3.5" /> Completed
                        </Badge>
                      )
                    } else if (st === 'start') {
                      badge = (
                        <Badge variant="outline" className="border-warning text-warning bg-warning/10 flex items-center gap-1">
                          <Icon.Refresh className="h-3.5 w-3.5 animate-spin" /> Running
                        </Badge>
                      )
                    } else if (st === 'error') {
                      badge = (
                        <Badge variant="outline" className="border-destructive text-destructive bg-destructive/10 flex items-center gap-1">
                          <Icon.X className="h-3.5 w-3.5" /> Error
                        </Badge>
                      )
                    } else {
                      badge = (
                        <Badge variant="outline" className="border-muted-foreground text-muted-foreground bg-muted/10">Pending</Badge>
                      )
                    }
                    return (
                      <li key={s} className="flex items-center justify-between border rounded px-2 py-1">
                        <div className="text-sm capitalize">{label}</div>
                        {badge}
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>
            </div>
            <div className="border rounded-md bg-muted/30 px-3 py-2 h-40 overflow-hidden text-sm">
              <ScrollArea className="h-full pr-2">
                <pre className="whitespace-pre-wrap break-all font-mono w-full max-w-full">{(genLogs || []).join('\n')}</pre>
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            {generating && genJobId ? (
              <Button variant="destructive" onClick={async () => { try { await apiFetch(`/api/generate/jobs/${encodeURIComponent(genJobId)}/cancel`, { method: 'POST' }); } catch { } }}>Cancel</Button>
            ) : null}
            {!generating && genError ? (
              <Button variant="outline" onClick={() => { setGenLogs([]); setGenSteps({}); setGenProgress(0); setGenError(null); if (genEventRef.current) { try { genEventRef.current.close() } catch { }; genEventRef.current = null }; generateDocument(); }}>Retry</Button>
            ) : null}
            <DialogClose asChild>
              <Button variant="secondary" onClick={() => setGenLogs(null)}>Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Document Metadata Modal */}
      <MetadataModal 
        metadata={metadataModal} 
        open={!!metadataModal} 
        onOpenChange={(open) => !open && setMetadataModal(null)}
        onRetry={async (filename: string) => {
          if (!selectedId) return;
          try {
            const r = await apiFetch(`/api/uploads/${selectedId}/metadata-extract`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename })
            });
            if (!r.ok) throw new Error('Failed to start metadata extraction');
            const data = await r.json();
            toast.success(data.message || 'Metadata extraction started');
            
            // Start tracking the re-extraction
            startTracking(selectedId, filename);
            
            // Close the modal
            setMetadataModal(null);
          } catch (err) {
            console.error('Failed to retry metadata extraction:', err);
            toast.error('Failed to start metadata extraction');
          }
        }}
      />
    </div>
  );
}

export default CustomersPage;

function RecentJobs({ selectedId }: { selectedId: number | null }) {
  const [jobs, setJobs] = React.useState<Array<any>>([])
  const [loading, setLoading] = React.useState(false)
  const [active, setActive] = React.useState<any | null>(null)

  const isCompileJob = (j: any) => {
    try {
      return j?.customerId === 0 || String(j?.customerName || '').toLowerCase() === 'template' || String(j?.file?.name || '') === 'generator.full.ts'
    } catch { return false }
  }

  // Status badge with label (parity with Jobs page)
  const statusBadge = (s: 'running' | 'done' | 'error' | 'cancelled') => {
    const label = s === 'done' ? 'Completed' : (s.charAt(0).toUpperCase() + s.slice(1))
    if (s === 'running') {
      return (
        <Badge variant="outline" className="shrink-0 border-warning text-warning bg-warning/10 flex items-center gap-1">
          <Icon.Refresh className="h-3.5 w-3.5 animate-spin" /> {label}
        </Badge>
      )
    }
    if (s === 'done') {
      return (
        <Badge variant="outline" className="shrink-0 border-success text-success bg-success/10 flex items-center gap-1">
          <Icon.Check className="h-3.5 w-3.5" /> {label}
        </Badge>
      )
    }
    if (s === 'cancelled') {
      return (
        <Badge variant="outline" className="shrink-0 border-muted-foreground text-muted-foreground bg-muted/10 flex items-center gap-1">
          <Icon.Stop className="h-3.5 w-3.5" /> {label}
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="shrink-0 border-destructive text-destructive bg-destructive/10 flex items-center gap-1">
        <Icon.X className="h-3.5 w-3.5" /> {label}
      </Badge>
    )
  }

  async function revealTemplateFolder(slug: string) {
    try {
      const r = await apiFetch(`/api/templates/${encodeURIComponent(slug)}/open-folder`, { method: 'POST' })
      const j = await r.json().catch(() => (null as any))
      if (!r.ok) throw new Error(String(j?.error || r.status))
      toast.success('Opened template folder')
    } catch (e: any) {
      toast.error(e?.message ? String(e.message) : 'Failed to open template folder')
    }
  }

  React.useEffect(() => {
    let ignore = false
    const load = async () => {
      try {
        setLoading(true)
        const r = await apiFetch('/api/generate/jobs')
        const j = await r.json().catch(() => ({}))
        if (!ignore) {
          const arr = Array.isArray(j?.jobs) ? j.jobs : []
          setJobs(arr)
          const filtered = selectedId ? arr.filter((x: any) => x.customerId === selectedId) : arr
          if (!active && filtered.length) { try { await openJob(filtered[0].id) } catch { } }
        }
      } catch { if (!ignore) setJobs([]) } finally { if (!ignore) setLoading(false) }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { ignore = true; clearInterval(t) }
  }, [selectedId])

  async function openJob(id: string) {
    try { const r = await apiFetch(`/api/generate/jobs/${encodeURIComponent(id)}`); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(String(r.status)); setActive(j) } catch { setActive(null) }
  }

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 md:col-span-4">
        <div className="border rounded-md p-2 h-[60vh] overflow-auto">
          {loading ? 'Loading...' : (
            <ul className="text-sm space-y-1 pr-2">
              {(selectedId ? jobs.filter((j: any) => j.customerId === selectedId) : jobs).map((j: any) => (
                <li key={j.id} onClick={() => openJob(j.id)} className={"flex items-center gap-2 justify-between rounded px-2 py-1 cursor-pointer " + ((active?.id === j.id) ? "bg-accent" : "hover:bg-accent/40")}>
                  <button className="text-left flex-1 truncate" onClick={() => openJob(j.id)}>
                    <div className="font-medium truncate">{j.template} • {j.customerName || j.customerId}</div>
                    <div className="text-xs text-muted-foreground truncate">{j.status} • {new Date(j.updatedAt).toLocaleString()} {j.file?.name ? `• ${j.file.name}` : ''}</div>
                  </button>
                  {(() => { const s = String(j.status || ''); const label = (s === 'done' ? 'Completed' : (s.charAt(0).toUpperCase() + s.slice(1))); if (s === 'running') return (<Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-warning text-warning bg-warning/10"><Icon.Refresh className="h-3.5 w-3.5 animate-spin" /></Badge>); if (s === 'done') return (<Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-success text-success bg-success/10"><Icon.Check className="h-3.5 w-3.5" /></Badge>); if (s === 'cancelled') return (<Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-muted-foreground text-muted-foreground bg-muted/10"><Icon.Stop className="h-3.5 w-3.5" /></Badge>); return (<Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-destructive text-destructive bg-destructive/10"><Icon.X className="h-3.5 w-3.5" /></Badge>) })()}
                </li>
              ))}
              {!(selectedId ? jobs.filter((j: any) => j.customerId === selectedId).length : jobs.length) ? (
                <li className="text-muted-foreground">No jobs yet.</li>
              ) : null}
            </ul>
          )}
        </div>
      </div>
      <div className="col-span-12 md:col-span-8">
        <div className="border rounded-md p-2 h-[60vh] overflow-auto text-sm">
          {!active ? (
            <div className="text-muted-foreground">Select a job to view details.</div>
          ) : (
            <div className="flex flex-col h-full space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="font-medium">
                    {isCompileJob(active) ? `${active.template}` : `${active.template} for ${String(active.customerName || active.customerId)}`}
                  </div>
                  <Badge variant={isCompileJob(active) ? 'secondary' : 'outline'}>{isCompileJob(active) ? 'Template Compile' : 'Document Generation'}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  {statusBadge(String(active.status) as any)}
                  {active.status === 'running' ? (
                    <Button size="icon" variant="ghost" aria-label="Cancel" title="Cancel" onClick={async (e) => { e.preventDefault(); try { if (active?.id) { await apiFetch(`/api/generate/jobs/${encodeURIComponent(active.id)}/cancel`, { method: 'POST' }); await openJob(active.id) } } catch { } }}>
                      <Icon.Stop className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {!isCompileJob(active) && active.file ? (
                    <>
                      <Button asChild size="icon" variant="ghost" aria-label="Open Folder" title="Open Folder">
                        <a href="#" onClick={async (e) => { e.preventDefault(); try { await apiFetch(`/api/generate/jobs/${encodeURIComponent(active.id)}/reveal`) } catch { } }}>
                          <Icon.Folder className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button asChild size="icon" variant="ghost" aria-label="Download" title="Download">
                        <a href={`/api/generate/jobs/${encodeURIComponent(active.id)}/file?download=true`}>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </>
                  ) : null}
                  <Button size="icon" variant="destructive" aria-label="Delete" title="Delete" onClick={(e) => { e.preventDefault(); /* open simple confirm */ try { if (active?.id) { fetch(`/api/generate/jobs/${encodeURIComponent(active.id)}`, { method: 'DELETE' }).then(() => setActive(null)).catch(() => { }) } } catch { } }}>
                    <Icon.Trash className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mb-2">{active.status} • {new Date(active.updatedAt).toLocaleString()}</div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Badge asChild variant="outline">
                  <a href="#" title="Reveal Template Folder" onClick={(e) => { e.preventDefault(); revealTemplateFolder(active.template) }}>
                    Template: {active.template}
                  </a>
                </Badge>
                {!isCompileJob(active) ? (
                  <Badge asChild variant="outline"><a href="#customers" title="View Customers">Customer: {active.customerName || active.customerId}</a></Badge>
                ) : null}
                {active.usedWorkspace ? (
                  <Badge variant="outline">Workspace: {active.usedWorkspace}</Badge>
                ) : null}
                {active.file?.name ? (
                  <Badge asChild variant="outline"><a href={`/api/generate/jobs/${encodeURIComponent(active.id)}/file?download=true`} title="Download file">File: {active.file.name}</a></Badge>
                ) : (
                  <Badge variant="outline">File: -</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mb-2">
                Started {active.startedAt ? new Date(active.startedAt).toLocaleString() : '-'}  Completed {active.completedAt ? new Date(active.completedAt).toLocaleString() : '-'}  Elapsed {(() => { try { const end = active.completedAt ? new Date(active.completedAt) : new Date(); const ms = end.getTime() - new Date(active.startedAt).getTime(); const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000); return `${m}:${String(s).padStart(2, '0')}` } catch { return '-' } })()}
              </div>
              {Array.isArray(active.steps) && active.steps.length ? (
                <div className="max-h-56 min-h-[6rem] flex flex-col min-h-0">
                  <div className="font-medium mb-1">Steps</div>
                  <ScrollArea className="h-full min-h-0">
                    <ul className="space-y-1 pr-2 pb-2">
                      {active.steps.map((s: any, idx: number) => (
                        <li key={idx} className="flex items-center justify-between border rounded px-2 py-1">
                          <div>
                            <div className="text-sm">{s.name}</div>
                            <div className="text-xs text-muted-foreground">{s.status || '-'} {s.durationMs ? ` ${(() => { const ms = s.durationMs || 0; const m = Math.floor(ms / 60000); const ss = Math.floor((ms % 60000) / 1000); return `${m}:${String(ss).padStart(2, '0')}` })()}` : ''}</div>
                          </div>
                          <div className="text-xs text-muted-foreground">{s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : ''} {s.endedAt ? `\u001a ${new Date(s.endedAt).toLocaleTimeString()}` : ''}</div>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </div>
              ) : null}
              <div className="flex-1 min-h-0 flex flex-col w-full">
                <div className="font-medium mb-1">Logs</div>
                <div className="border rounded bg-muted/30 p-2 flex-1 min-h-0">
                  <ScrollArea className="flex-1 min-h-0 h-full">
                    <pre className="whitespace-pre-wrap pr-2">{Array.isArray(active.logs) ? active.logs.join('\n') : ''}</pre>
                  </ScrollArea>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}



