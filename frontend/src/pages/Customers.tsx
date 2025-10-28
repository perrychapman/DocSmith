import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/Button";
import { Input } from "../components/ui/input";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogClose } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Icon } from "../components/icons";
import { Maximize2, Minimize2, Search, ExternalLink, Download, FileText, FileSpreadsheet, FileCode, FileQuestion, FileType, Info, Loader2, Pin, PinOff, RefreshCw, Eye, AlertCircle, Trash, Upload, Zap, Sparkles, MessageSquare, Settings, Star, GripVertical } from "lucide-react";
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
import { useDebouncedState, useUserActivity } from "../lib/hooks";
import { SailpointConfigModal } from "../components/SailpointConfigModal";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Customer = { id: number; name: string; createdAt: string };
type UploadItem = { name: string; path: string; size: number; modifiedAt: string };

const INLINE_PREVIEW_EXTENSIONS = new Set<string>(['.pdf'])


export function CustomersPage() {
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = React.useState(true);
  const [name, setName] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [configCustomerId, setConfigCustomerId] = React.useState<number | null>(null);
  const [sailpointConfigOpen, setSailpointConfigOpen] = React.useState(false);
  
  // Favorites persist across app runs via localStorage
  const [favorites, setFavorites] = React.useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem('docsmith-favorite-customers');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });
  
  // Custom sort order persists across app runs via localStorage
  const [customOrder, setCustomOrder] = React.useState<number[]>(() => {
    try {
      const stored = localStorage.getItem('docsmith-customer-order');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  
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
  const [counts, setCounts] = React.useState<Record<number, { embedded?: number; generated?: number; chats?: number }>>({});
  const [pinningTest, setPinningTest] = React.useState<string | null>(null);
  const [pinnedDocs, setPinnedDocs] = React.useState<Set<string>>(new Set());
  const [countsLoading, setCountsLoading] = React.useState(false);
  const [generateOpen, setGenerateOpen] = React.useState(false);
  const [templates, setTemplates] = React.useState<Array<{ slug: string; name: string; hasFullGen?: boolean; avgGenerationTimeFormatted?: string }>>([]);
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
  const [showNoDocsWarning, setShowNoDocsWarning] = React.useState(false);
  // External chat cards to display generation metadata in chat
  const [chatCards, setChatCards] = React.useState<Array<{ id: string; template?: string; jobId?: string; jobStatus?: 'running' | 'done' | 'error' | 'cancelled'; filename?: string; aiContext?: string; timestamp?: number; side?: 'user' | 'assistant' }>>([]);
  const pollingIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  // Metadata modal state
  const [metadataModal, setMetadataModal] = React.useState<DocumentMetadata | null>(null);
  const { metadataProcessing, startTracking, setRefreshCallback } = useMetadata();
  const [uploadMetadataCache, setUploadMetadataCache] = React.useState<Map<string, { hasMetadata: boolean; isGenerated?: boolean }>>(new Map());

  // Track workspace-level AI operations to disable concurrent operations
  const hasActiveAIOperation = generating || metadataProcessing.size > 0;

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
  
  // Debounced search queries for better performance
  const [debouncedDocQuery, docQuery, setDocQuery] = useDebouncedState<string>("", 300);
  const [debouncedGenTemplateQuery, genTemplateQuery, setGenTemplateQuery] = useDebouncedState<string>("", 300);
  const [debouncedGenDocQuery, genDocQuery, setGenDocQuery] = useDebouncedState<string>("", 300);
  
  // Use deferred values to allow input to update instantly while deferring expensive renders
  const deferredDocQuery = React.useDeferredValue(debouncedDocQuery);
  const deferredGenTemplateQuery = React.useDeferredValue(debouncedGenTemplateQuery);
  const deferredGenDocQuery = React.useDeferredValue(debouncedGenDocQuery);
  
  // Track user activity to pause polling during input
  const [isUserActive, signalUserActivity] = useUserActivity(2000);
  
  const [docsTab, setDocsTab] = React.useState('uploaded'); // 'uploaded' or 'generated'
  
  // Regenerate dialog state
  const [regenerateOpen, setRegenerateOpen] = React.useState(false);
  const [regenerateDoc, setRegenerateDoc] = React.useState<{ name: string; customerId: number } | null>(null);
  const [regenerateDocJobInfo, setRegenerateDocJobInfo] = React.useState<{ template: string; instructions?: string; pinnedDocuments?: string[] } | null>(null);
  const [revisionInstructions, setRevisionInstructions] = React.useState('');
  const [regenerating, setRegenerating] = React.useState(false);
  
  // Delete generated document dialog state
  const [deleteGenDocOpen, setDeleteGenDocOpen] = React.useState(false);
  const [deleteGenDocName, setDeleteGenDocName] = React.useState<string | null>(null);
  const [deletingGenDoc, setDeletingGenDoc] = React.useState(false);
  
  // Upload/embed generated document state
  const [uploadingGenDoc, setUploadingGenDoc] = React.useState(false);
  const [uploadGenDocName, setUploadGenDocName] = React.useState<string | null>(null);
  
  // Track which generated documents have been uploaded to workspace
  const [uploadedGenDocs, setUploadedGenDocs] = React.useState<Set<string>>(new Set());
  
  const rowsClass = panelMode === 'split'
    ? 'grid grid-rows-[minmax(0,2fr)_minmax(0,1fr)]'
    : (panelMode === 'chat'
      ? 'grid grid-rows-[minmax(0,1fr)_minmax(0,0fr)]'
      : 'grid grid-rows-[minmax(0,0fr)_minmax(0,1fr)]');

  // Memoized filtered lists for better performance - using deferred values for smooth input
  const filteredUploads = React.useMemo(() => {
    if (!deferredDocQuery.trim()) return uploads;
    const query = deferredDocQuery.trim().toLowerCase();
    return uploads.filter((u) => u.name.toLowerCase().includes(query));
  }, [uploads, deferredDocQuery]);

  const filteredGeneratedDocs = React.useMemo(() => {
    if (!deferredDocQuery.trim()) return generatedDocs;
    const query = deferredDocQuery.trim().toLowerCase();
    return generatedDocs.filter((d) => d.name.toLowerCase().includes(query));
  }, [generatedDocs, deferredDocQuery]);

  const filteredTemplates = React.useMemo(() => {
    if (!deferredGenTemplateQuery.trim()) return templates;
    const query = deferredGenTemplateQuery.trim().toLowerCase();
    return templates.filter(t => (t.name || t.slug).toLowerCase().includes(query));
  }, [templates, deferredGenTemplateQuery]);

  const filteredGenDocuments = React.useMemo(() => {
    if (!deferredGenDocQuery.trim()) return genDocuments;
    const query = deferredGenDocQuery.trim().toLowerCase();
    return genDocuments.filter(doc =>
      doc.name.toLowerCase().includes(query) ||
      doc.reasoning.toLowerCase().includes(query)
    );
  }, [genDocuments, deferredGenDocQuery]);

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
        const map: Record<number, { embedded?: number; generated?: number; chats?: number }> = {};
        
        // First, populate with embedded docs and chats from metrics API
        for (const m of metrics) {
          map[m.id] = { embedded: m.docs, chats: m.chats };
        }
        
        // Then fetch generated docs count for each customer
        await Promise.allSettled(customers.map(async (c) => {
          try {
            const r = await apiFetch(`/api/documents/${c.id}/files`);
            if (r.ok) {
              const genDocs: UploadItem[] = await r.json();
              const genCount = Array.isArray(genDocs) ? genDocs.length : 0;
              map[c.id] = { ...(map[c.id] || {}), generated: genCount };
            }
          } catch {
            // Silently fail, keep existing count
          }
        }));
        
        if (!ignore) setCounts(map);
      } catch {
        // Fallback per-customer (limited to first 10 to reduce load)
        const list = customers.slice(0, 10);
        const next: Record<number, { embedded?: number; generated?: number; chats?: number }> = {};
        await Promise.allSettled(list.map(async (c) => {
          // Get embedded/uploaded documents
          try {
            const r = await apiFetch(`/api/uploads/${c.id}`);
            const items: UploadItem[] = await r.json().catch(() => []);
            next[c.id] = { ...(next[c.id] || {}), embedded: Array.isArray(items) ? items.length : 0 };
          } catch { next[c.id] = { ...(next[c.id] || {}), embedded: 0 } }
          
          // Get generated documents
          try {
            const r = await apiFetch(`/api/documents/${c.id}/files`);
            const items: UploadItem[] = await r.json().catch(() => []);
            next[c.id] = { ...(next[c.id] || {}), generated: Array.isArray(items) ? items.length : 0 };
          } catch { next[c.id] = { ...(next[c.id] || {}), generated: 0 } }
          
          // Get chats
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

  // Keep embedded docs count in sync with selected customer's uploads list
  React.useEffect(() => {
    if (!selectedId) return;
    setCounts((prev) => {
      const prevCount = prev[selectedId]?.embedded;
      if (prevCount === uploads.length) return prev;
      return { ...prev, [selectedId]: { ...(prev[selectedId] || {}), embedded: uploads.length } };
    });
  }, [uploads, selectedId]);

  // Keep generated docs count in sync with selected customer's generated docs list
  React.useEffect(() => {
    if (!selectedId) return;
    setCounts((prev) => {
      const prevCount = prev[selectedId]?.generated;
      if (prevCount === generatedDocs.length) return prev;
      return { ...prev, [selectedId]: { ...(prev[selectedId] || {}), generated: generatedDocs.length } };
    });
  }, [generatedDocs, selectedId]);

  // Live refresh chat count only for selected customer's workspace
  // Pauses during active user input to prevent interruptions
  React.useEffect(() => {
    if (!selectedId || !wsSlug) return;
    let ignore = false;
    let timer: any;
    async function refreshChats() {
      // Skip refresh if user is actively typing
      if (isUserActive) {
        if (!ignore) timer = setTimeout(refreshChats, 15000);
        return;
      }
      try {
        const data = await A.workspaceChats(wsSlug!, 200, 'desc').catch(() => null);
        const arr = Array.isArray((data as any)?.history) ? (data as any).history : (Array.isArray((data as any)?.chats) ? (data as any).chats : (Array.isArray(data) ? (data as any) : []));
        const count = Array.isArray(arr) ? arr.length : 0;
        
        // Only update state if count actually changed (prevent unnecessary re-renders)
        if (!ignore) {
          setCounts((prev) => {
            const prevCount = prev[selectedId!]?.chats;
            if (prevCount === count) return prev;
            return { ...prev, [selectedId!]: { ...(prev[selectedId!] || {}), chats: count } };
          });
        }
      } catch { }
      if (!ignore) timer = setTimeout(refreshChats, 15000);
    }
    refreshChats();
    return () => { ignore = true; if (timer) clearTimeout(timer); };
  }, [selectedId, wsSlug, isUserActive]);

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
        // Sort by most recently modified first
        const sorted = Array.isArray(data) ? data.sort((a, b) => 
          new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
        ) : [];
        if (!ignore) setUploads(sorted);
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
        // Sort by most recently modified first
        const sorted = Array.isArray(data) ? data.sort((a, b) => 
          new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
        ) : [];
        if (!ignore) setGeneratedDocs(sorted);
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

  // Cross-reference generated docs with uploads to track which have been uploaded to workspace
  React.useEffect(() => {
    if (!uploads.length || !generatedDocs.length) {
      setUploadedGenDocs(new Set());
      return;
    }
    
    // Create a set of upload filenames for quick lookup
    const uploadFilenames = new Set(uploads.map(u => u.name));
    
    // Check which generated docs exist in uploads
    const uploaded = new Set<string>();
    generatedDocs.forEach(doc => {
      if (uploadFilenames.has(doc.name)) {
        uploaded.add(doc.name);
      }
    });
    
    setUploadedGenDocs(uploaded);
  }, [uploads, generatedDocs]);

  // Load metadata for uploaded documents to check if they're generated
  React.useEffect(() => {
    if (!selectedId || !uploads.length) return;
    
    let ignore = false;
    async function loadUploadMetadata() {
      for (const upload of uploads) {
        // Skip if already cached
        if (uploadMetadataCache.has(upload.name)) continue;
        
        try {
          const r = await apiFetch(`/api/uploads/${selectedId}/metadata?name=${encodeURIComponent(upload.name)}`);
          const data = await r.json();
          
          const hasMetadata = data.metadata && (data.metadata.documentType || data.metadata.purpose || (data.metadata.keyTopics && data.metadata.keyTopics.length > 0));
          const isGenerated = data.metadata?.extraFields?.isGenerated === true;
          
          if (!ignore) {
            setUploadMetadataCache(prev => new Map(prev).set(upload.name, { hasMetadata, isGenerated }));
          }
        } catch (err) {
          console.error(`Failed to load metadata for ${upload.name}:`, err);
        }
      }
    }
    
    loadUploadMetadata();
    return () => { ignore = true };
  }, [uploads, selectedId]);

  // Load existing gen_cards for the workspace
  React.useEffect(() => {
    let ignore = false;
    async function loadGenCards() {
      if (!wsSlug) return;
      try {
        const response = await A.genCardsByWorkspace(wsSlug);
        if (!ignore && response?.cards) {
          // Filter and sort cards by timestamp
          const validCards = Array.isArray(response.cards) ? response.cards.filter((c: any) => c.id) : [];
          setChatCards(validCards.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0)));
        }
      } catch (err) {
        console.error('Failed to load gen cards:', err);
        if (!ignore) setChatCards([]);
      }
    }
    loadGenCards();
    return () => { ignore = true };
  }, [wsSlug]);

  // Poll for gen_card updates when there are running jobs
  // Pauses during active user input to prevent interruptions
  React.useEffect(() => {
    if (!wsSlug) {
      // Clear any existing polling when workspace changes
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }
    
    // Function to poll for updates
    const pollForUpdates = async () => {
      // Skip polling if user is actively typing
      if (isUserActive) {
        return;
      }
      try {
        const response = await A.genCardsByWorkspace(wsSlug);
        if (response?.cards) {
          const validCards = Array.isArray(response.cards) ? response.cards.filter((c: any) => c.id) : [];
          const sorted = validCards.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
          
          // Only update state if cards actually changed (prevent unnecessary re-renders)
          setChatCards(prev => {
            if (prev.length !== sorted.length) return sorted;
            const changed = sorted.some((card: any, idx: number) => {
              const prevCard = prev[idx];
              return !prevCard || 
                     prevCard.id !== card.id || 
                     prevCard.jobStatus !== card.jobStatus ||
                     prevCard.timestamp !== card.timestamp;
            });
            return changed ? sorted : prev;
          });
          
          // Check if we should stop polling
          const hasRunningJobs = validCards.some((c: any) => c.jobStatus === 'running');
          if (!hasRunningJobs && !generating && pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        }
      } catch (err) {
        console.error('Failed to poll gen cards:', err);
      }
    };
    
    // Start polling if there are running jobs or generation is active
    const hasRunningJobs = chatCards.some(card => card.jobStatus === 'running');
    const shouldPoll = hasRunningJobs || generating;
    
    if (shouldPoll && !pollingIntervalRef.current) {
      // Start new polling interval
      pollingIntervalRef.current = setInterval(pollForUpdates, 3000);
    } else if (!shouldPoll && pollingIntervalRef.current) {
      // Stop polling if no longer needed
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [wsSlug, chatCards.some(c => c.jobStatus === 'running'), generating, isUserActive]);

  // Load templates once when opening generate modal
  React.useEffect(() => {
    if (!generateOpen) return;
    let ignore = false;
    (async () => {
      setLoadingTemplates(true);
      try {
        const r = await apiFetch(`/api/templates`);
        const data = await r.json().catch(() => ({}));
        const list: Array<{ slug: string; name: string; hasFullGen?: boolean }> = Array.isArray(data?.templates) ? data.templates : [];
        
        // Load metadata for each template to get avgGenerationTimeFormatted
        const templatesWithMetadata = await Promise.all(
          list.map(async (tmpl) => {
            try {
              const metaRes = await apiFetch(`/api/templates/${encodeURIComponent(tmpl.slug)}/metadata`);
              if (metaRes.ok) {
                const metaData = await metaRes.json();
                return {
                  ...tmpl,
                  avgGenerationTimeFormatted: metaData?.metadata?.avgGenerationTimeFormatted
                };
              }
            } catch {
              // Silently fail, just don't include metadata
            }
            return tmpl;
          })
        );
        
        if (!ignore) setTemplates(templatesWithMetadata);
        if (!ignore && templatesWithMetadata.length && !selectedTemplate) setSelectedTemplate(templatesWithMetadata[0].slug);
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

  function handleGenerateClick() {
    // If no documents selected, show warning
    if (genPinnedDocs.size === 0) {
      setShowNoDocsWarning(true);
      return;
    }
    // Otherwise, proceed directly
    generateDocument();
  }

  function proceedWithoutDocs() {
    setShowNoDocsWarning(false);
    generateDocument();
  }

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
      const pinnedDocPaths: string[] = [];
      if (docsToPinList.length > 0) {
        toast.info(`Pinning ${docsToPinList.length} selected document(s)...`);
        for (const doc of docsToPinList) {
          try {
            await apiFetch(`/api/anythingllm/workspace/${encodeURIComponent(wsSlug)}/update-pin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ docPath: doc.anythingllmPath, pinStatus: true })
            });
            // Track the pinned document path
            if (doc.anythingllmPath) {
              pinnedDocPaths.push(doc.anythingllmPath);
            }
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
      
      // Step 3: Start generation with pinned document paths
      setGenSteps({}); setGenProgress(0); setGenError(null);
      const extra = genInstructions && genInstructions.trim().length ? `&instructions=${encodeURIComponent(genInstructions)}` : '';
      const pinnedDocsParam = pinnedDocPaths.length > 0 ? `&pinnedDocuments=${encodeURIComponent(JSON.stringify(pinnedDocPaths))}` : '';
      const url = `/api/generate/stream?customerId=${encodeURIComponent(String(selectedId))}&template=${encodeURIComponent(String(selectedTemplate))}${extra}${pinnedDocsParam}`;
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
              // Inject chat cards for this job
              setChatCards((prev) => {
                const next = prev.filter((c) => c.id !== jid && c.id !== `${jid}-reply`)
                const timestamp = Date.now()
                
                // User card: Document requested
                const userCard = {
                  id: jid,
                  side: 'user' as const,
                  template: selectedTemplate || undefined,
                  jobId: jid,
                  jobStatus: 'running' as const,
                  aiContext: genInstructions || undefined,
                  timestamp
                }
                
                // Assistant reply card: Document generating
                const assistantCard = {
                  id: `${jid}-reply`,
                  side: 'assistant' as const,
                  template: selectedTemplate || undefined,
                  jobId: jid,
                  jobStatus: 'running' as const,
                  timestamp
                }
                
                next.push(userCard, assistantCard)
                
                // Save both to backend
                if (wsSlug) { 
                  A.upsertGenCard({ id: jid, workspaceSlug: wsSlug, side: 'user', template: selectedTemplate || undefined, jobId: jid, jobStatus: 'running' as const, aiContext: genInstructions || undefined, timestamp }).catch(() => { })
                  A.upsertGenCard({ id: `${jid}-reply`, workspaceSlug: wsSlug, side: 'assistant', template: selectedTemplate || undefined, jobId: jid, jobStatus: 'running' as const, timestamp }).catch(() => { })
                }
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
              const timestamp = Date.now()
              setChatCards((prev) => prev.map((c) => 
                c.id === `${jid}-reply` 
                  ? { ...c, jobStatus: 'error' as const, timestamp } 
                  : c
              ))
              // Update assistant card in backend
              if (wsSlug) {
                A.upsertGenCard({ 
                  id: `${jid}-reply`, 
                  workspaceSlug: wsSlug, 
                  side: 'assistant', 
                  template: selectedTemplate || undefined, 
                  jobId: jid, 
                  jobStatus: 'error', 
                  timestamp 
                }).catch(() => { })
              }
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
              const now = Date.now()
              setChatCards((prev) => {
                // Update the assistant reply card to 'done' with filename
                const updated = prev.map((c) => 
                  c.id === `${jid}-reply` 
                    ? { ...c, jobStatus: 'done' as const, filename: fileName || c.filename, timestamp: now }
                    : c
                );
                
                // Persist updated assistant card
                if (wsSlug) {
                  A.upsertGenCard({ 
                    id: `${jid}-reply`, 
                    workspaceSlug: wsSlug, 
                    side: 'assistant', 
                    template: selectedTemplate || undefined, 
                    jobId: jid, 
                    jobStatus: 'done', 
                    filename: fileName || undefined, 
                    timestamp: now 
                  }).catch(() => { })
                }
                return updated;
              })
            } else if (genJobId) {
              const jid = genJobId
              const now = Date.now()
              setChatCards((prev) => {
                // Update the assistant reply card to 'done' with filename
                const updated = prev.map((c) => 
                  c.id === `${jid}-reply` 
                    ? { ...c, jobStatus: 'done' as const, filename: fileName || c.filename, timestamp: now }
                    : c
                );
                
                if (wsSlug) {
                  A.upsertGenCard({ 
                    id: `${jid}-reply`, 
                    workspaceSlug: wsSlug, 
                    side: 'assistant', 
                    template: selectedTemplate || undefined, 
                    jobId: jid, 
                    jobStatus: 'done', 
                    filename: fileName || undefined, 
                    timestamp: now 
                  }).catch(() => { })
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
                  // Sort by most recently modified first
                  const sorted = Array.isArray(d2) ? d2.sort((a, b) => 
                    new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
                  ) : [];
                  setUploads(sorted) 
                } catch { } 
              })();
              (async () => { 
                try { 
                  const r3 = await apiFetch(`/api/documents/${selectedId}/files`); 
                  const d3: UploadItem[] = await r3.json(); 
                  // Sort by most recently modified first
                  const sorted = Array.isArray(d3) ? d3.sort((a, b) => 
                    new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
                  ) : [];
                  setGeneratedDocs(sorted) 
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
          setChatCards((prev) => prev.map((c) => 
            c.id === `${jid}-reply` 
              ? { ...c, jobStatus: 'error' as const, timestamp: now } 
              : c
          ))
          if (wsSlug) { 
            A.upsertGenCard({ 
              id: `${jid}-reply`, 
              workspaceSlug: wsSlug, 
              side: 'assistant', 
              template: selectedTemplate || undefined, 
              jobId: jid, 
              jobStatus: 'error', 
              timestamp: now 
            }).catch(() => { }) 
          }
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
  // Pause polling during user input to improve responsiveness
  React.useEffect(() => {
    if (!selectedId) return;
    let ignore = false;
    let timer: any;
    async function refresh() {
      // Skip polling if user is actively typing
      if (isUserActive) {
        if (!ignore) timer = setTimeout(refresh, 15000);
        return;
      }
      
      try {
        const r = await apiFetch(`/api/uploads/${selectedId}`);
        if (!r.ok) throw new Error(String(r.status));
        const data: UploadItem[] = await r.json();
        
        // Only update state if uploads actually changed (prevent unnecessary re-renders)
        if (!ignore) {
          setUploads(prev => {
            const newData = Array.isArray(data) ? data : [];
            if (prev.length !== newData.length) return newData;
            const changed = newData.some((item, idx) => {
              const prevItem = prev[idx];
              return !prevItem || 
                     prevItem.name !== item.name || 
                     prevItem.size !== item.size ||
                     prevItem.modifiedAt !== item.modifiedAt;
            });
            return changed ? newData : prev;
          });
        }
      } catch { }
      if (!ignore) timer = setTimeout(refresh, 15000);
    }
    refresh();
    return () => { ignore = true; if (timer) clearTimeout(timer); };
  }, [selectedId, isUserActive]);

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

  async function handleRegenerate() {
    if (!regenerateDoc || !selectedId) return;

    try {
      setRegenerating(true);
      
      // Use cached job info if available, otherwise fetch it
      let templateSlug = regenerateDocJobInfo?.template || '';
      let originalInstructions = regenerateDocJobInfo?.instructions || '';
      let pinnedDocuments = regenerateDocJobInfo?.pinnedDocuments;
      
      // If we don't have cached job info, fetch it
      if (!regenerateDocJobInfo) {
        try {
          const jobsResponse = await apiFetch('/api/generate/jobs');
          const jobsData = await jobsResponse.json();
          const jobs = Array.isArray(jobsData?.jobs) ? jobsData.jobs : [];
          
          const matchingJob = jobs.find((j: any) => 
            j.customerId === selectedId && 
            j.file?.name === regenerateDoc.name &&
            j.status === 'done'
          );
          
          if (matchingJob) {
            templateSlug = matchingJob.template;
            originalInstructions = matchingJob.instructions || '';
            pinnedDocuments = matchingJob.pinnedDocuments;
          } else {
            toast.error('Unable to find original generation job for this document');
            setRegenerating(false);
            return;
          }
        } catch (err) {
          console.error('Failed to retrieve original job:', err);
          toast.error('Failed to retrieve original job information');
          setRegenerating(false);
          return;
        }
      }
      
      // Step 1: Re-pin the original documents if needed
      if (pinnedDocuments && pinnedDocuments.length > 0 && wsSlug) {
        toast.info(`Re-pinning ${pinnedDocuments.length} document(s)...`);
        
        // Track which documents were pinned for later unpinning
        const pinnedDocNames = new Set<string>();
        
        for (const docPath of pinnedDocuments) {
          try {
            await apiFetch(`/api/anythingllm/workspace/${encodeURIComponent(wsSlug)}/update-pin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ docPath, pinStatus: true })
            });
            
            // Extract filename from docPath and track it
            // docPath format is typically "customerName/filename.ext-uuid.json"
            const filename = docPath.split('/').pop()?.replace(/-[a-f0-9-]+\.json$/, '') || '';
            if (filename) {
              pinnedDocNames.add(filename);
            }
          } catch (err) {
            console.error(`Failed to re-pin document ${docPath}:`, err);
          }
        }
        
        // Update genPinnedDocs so unpinning logic can find them later
        setGenPinnedDocs(pinnedDocNames);
      } else {
        // No documents to pin for regeneration
        setGenPinnedDocs(new Set());
      }

      // Step 2: Combine original instructions with revision instructions
      const combinedInstructions = originalInstructions 
        ? `${originalInstructions}\n\nREVISIONS:\n${revisionInstructions}`
        : revisionInstructions;

      // Step 4: Use streaming API for real-time updates and gen_cards (like regular generation)
      setGenSteps({}); 
      setGenProgress(0); 
      setGenError(null);
      setRegenerateOpen(false); // Close dialog before starting
      setRevisionInstructions('');
      setRegenerateDocJobInfo(null); // Clear cached job info
      
      const instructionsParam = combinedInstructions ? `&instructions=${encodeURIComponent(combinedInstructions)}` : '';
      const pinnedDocsParam = pinnedDocuments && pinnedDocuments.length > 0 
        ? `&pinnedDocuments=${encodeURIComponent(JSON.stringify(pinnedDocuments))}` 
        : '';
      const url = `/api/generate/stream?customerId=${encodeURIComponent(String(selectedId))}&template=${encodeURIComponent(templateSlug)}${instructionsParam}${pinnedDocsParam}`;
      const es = apiEventSource(url);
      genEventRef.current = es;
      let fileName: string | null = null;
      
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (data?.type === 'log') {
            // suppress
          } else if (data?.type === 'info') {
            if (data.jobId) {
              const jid = String(data.jobId);
              setGenJobId(jid);
              // Inject chat cards for regeneration job
              setChatCards((prev) => {
                const next = prev.filter((c) => c.id !== jid && c.id !== `${jid}-reply`);
                const timestamp = Date.now();
                
                const userCard = {
                  id: jid,
                  side: 'user' as const,
                  template: templateSlug || undefined,
                  jobId: jid,
                  jobStatus: 'running' as const,
                  aiContext: combinedInstructions || undefined,
                  timestamp
                };
                
                const assistantCard = {
                  id: `${jid}-reply`,
                  side: 'assistant' as const,
                  template: templateSlug || undefined,
                  jobId: jid,
                  jobStatus: 'running' as const,
                  timestamp
                };
                
                next.push(userCard, assistantCard);
                
                if (wsSlug) {
                  A.upsertGenCard({ id: jid, workspaceSlug: wsSlug, side: 'user', template: templateSlug || undefined, jobId: jid, jobStatus: 'running' as const, aiContext: combinedInstructions || undefined, timestamp }).catch(() => {});
                  A.upsertGenCard({ id: `${jid}-reply`, workspaceSlug: wsSlug, side: 'assistant', template: templateSlug || undefined, jobId: jid, jobStatus: 'running' as const, timestamp }).catch(() => {});
                }
                return next;
              });
            }
          } else if (data?.type === 'step') {
            const name = String(data.name || '');
            const status = (String(data.status || 'start') as 'start' | 'ok');
            const p = typeof data.progress === 'number' ? Math.max(0, Math.min(100, Math.floor(data.progress))) : null;
            setGenSteps((prev) => ({ ...(prev || {}), [name]: status }));
            if (p != null) setGenProgress(p);
          } else if (data?.type === 'error') {
            const errMsg = String(data.error || 'unknown');
            setGenError(errMsg);
            if (genJobId) {
              const jid = genJobId;
              const timestamp = Date.now();
              setChatCards((prev) => prev.map((c) => 
                c.id === `${jid}-reply` 
                  ? { ...c, jobStatus: 'error' as const, timestamp } 
                  : c
              ));
              if (wsSlug) {
                A.upsertGenCard({ id: `${jid}-reply`, workspaceSlug: wsSlug, side: 'assistant', template: templateSlug || undefined, jobId: jid, jobStatus: 'error', timestamp }).catch(() => {});
              }
            }
            toast.error(`Regeneration failed: ${errMsg}`);
            if (es && typeof es.close === 'function') es.close();
            genEventRef.current = null;
            setRegenerating(false);
            setGenJobId(null);
          } else if (data?.type === 'done') {
            if (data?.file?.name) fileName = String(data.file.name);
            setGenProgress(100);
            if (data?.jobId) {
              const jid = String(data.jobId);
              const now = Date.now();
              setChatCards((prev) => {
                const updated = prev.map((c) => 
                  c.id === `${jid}-reply` 
                    ? { ...c, jobStatus: 'done' as const, filename: fileName || c.filename, timestamp: now }
                    : c
                );
                if (wsSlug) {
                  A.upsertGenCard({ id: `${jid}-reply`, workspaceSlug: wsSlug, side: 'assistant', template: templateSlug || undefined, jobId: jid, jobStatus: 'done', filename: fileName || undefined, timestamp: now }).catch(() => {});
                }
                return updated;
              });
            }
            toast.success('Document regenerated successfully');
            
            // Refresh generated docs
            apiFetch(`/api/documents/${selectedId}/files`)
              .then(r => r.json())
              .then((data: UploadItem[]) => {
                const sorted = Array.isArray(data) ? data.sort((a, b) => 
                  new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
                ) : [];
                setGeneratedDocs(sorted);
              })
              .catch(() => {});
            
            if (es && typeof es.close === 'function') es.close();
            genEventRef.current = null;
            setRegenerating(false);
            setGenJobId(null);
          }
        } catch (err) {
          console.error('Stream parse error:', err);
        }
      };
      
      es.onerror = (err) => {
        console.error('Stream error:', err);
        toast.error('Regeneration stream error');
        if (genJobId) {
          const jid = genJobId;
          const now = Date.now();
          setChatCards((prev) => prev.map((c) => 
            c.id === `${jid}-reply` 
              ? { ...c, jobStatus: 'error' as const, timestamp: now } 
              : c
          ));
          if (wsSlug) { 
            A.upsertGenCard({ 
              id: `${jid}-reply`, 
              workspaceSlug: wsSlug, 
              side: 'assistant', 
              template: templateSlug || undefined, 
              jobId: jid, 
              jobStatus: 'error', 
              timestamp: now 
            }).catch(() => { }); 
          }
        }
        if (es && typeof es.close === 'function') es.close();
        genEventRef.current = null;
        setRegenerating(false);
        setGenJobId(null);
      };

    } catch (error) {
      console.error(error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to regenerate document';
      toast.error(errorMsg);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDeleteGeneratedDoc() {
    if (!deleteGenDocName || !selectedId) return;

    try {
      setDeletingGenDoc(true);

      const response = await apiFetch(`/api/documents/${selectedId}/file?name=${encodeURIComponent(deleteGenDocName)}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      toast.success('Document deleted successfully');
      setDeleteGenDocOpen(false);
      setDeleteGenDocName(null);

      // Refresh generated docs list
      try {
        const r = await apiFetch(`/api/documents/${selectedId}/files`);
        if (r.ok) {
          const data: UploadItem[] = await r.json();
          const sorted = Array.isArray(data) ? data.sort((a, b) =>
            new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
          ) : [];
          setGeneratedDocs(sorted);
        }
      } catch (err) {
        console.error('Failed to refresh generated docs:', err);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to delete document');
    } finally {
      setDeletingGenDoc(false);
    }
  }

  async function embedGeneratedDoc(filename: string) {
    if (!selectedId) {
      toast.error('No customer selected');
      return;
    }

    try {
      setUploadingGenDoc(true);
      setUploadGenDocName(filename);
      
      const toastId = (toast as any).loading ? (toast as any).loading("Uploading and embedding...") : undefined;

      // Call backend endpoint to copy and embed the generated document
      const response = await apiFetch(`/api/documents/${selectedId}/embed-generated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as any)?.error || 'Failed to embed document');
      }

      const json = await response.json().catch(() => ({}));
      const uploadedFilename = (json as any)?.filename || filename;

      // Start tracking metadata extraction
      console.log('[EMBED-GEN] Starting metadata tracking for:', uploadedFilename);
      startTracking(selectedId, uploadedFilename);

      // Refresh uploads list
      try {
        const r2 = await apiFetch(`/api/uploads/${selectedId}`);
        const d2: UploadItem[] = await r2.json();
        setUploads(d2);
        
        // Reload metadata for this file to get the isGenerated flag
        try {
          const r3 = await apiFetch(`/api/uploads/${selectedId}/metadata?name=${encodeURIComponent(uploadedFilename)}`);
          const data = await r3.json();
          
          const hasMetadata = data.metadata && (data.metadata.documentType || data.metadata.purpose || (data.metadata.keyTopics && data.metadata.keyTopics.length > 0));
          const isGenerated = data.metadata?.extraFields?.isGenerated === true;
          
          console.log(`[EMBED-GEN] Loaded metadata for ${uploadedFilename}: isGenerated=${isGenerated}`);
          
          setUploadMetadataCache(prev => new Map(prev).set(uploadedFilename, { hasMetadata, isGenerated }));
        } catch (metaErr) {
          console.error('Failed to reload metadata:', metaErr);
          // If metadata loading fails, just clear the cache entry
          setUploadMetadataCache(prev => {
            const newCache = new Map(prev);
            newCache.delete(uploadedFilename);
            return newCache;
          });
        }
      } catch (err) {
        console.error('Failed to refresh uploads:', err);
      }

      if ((json as any)?.embeddingWarning) {
        toast.warning?.((json as any).embeddingWarning) ?? toast.success("Uploaded; embedding may still be processing");
      } else {
        if (toastId) (toast as any).success("Embedding completed", { id: toastId });
        else toast.success("Embedding completed");
      }

      // Add to uploaded set
      setUploadedGenDocs(prev => new Set(prev).add(filename));

      // Switch to uploaded tab to show the newly embedded document
      setDocsTab('uploaded');
    } catch (error) {
      console.error('Failed to embed generated document:', error);
      toast.error((error as Error).message || 'Failed to embed document');
    } finally {
      setUploadingGenDoc(false);
      setUploadGenDocName(null);
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

  function toggleFavorite(customerId: number) {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(customerId)) {
        newFavorites.delete(customerId);
      } else {
        newFavorites.add(customerId);
      }
      // Persist to localStorage
      localStorage.setItem('docsmith-favorite-customers', JSON.stringify(Array.from(newFavorites)));
      return newFavorites;
    });
  }

  // Sort customers: by custom order if exists, then favorites first, then alphabetically
  const sortedCustomers = React.useMemo(() => {
    const sorted = [...customers];
    
    // Create order map from customOrder array
    const orderMap = new Map(customOrder.map((id, index) => [id, index]));
    
    sorted.sort((a, b) => {
      // First check custom order
      const aOrder = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity;
      const bOrder = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity;
      
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      
      // If no custom order, sort by favorites
      const aFav = favorites.has(a.id);
      const bFav = favorites.has(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      
      // Finally sort alphabetically
      return a.name.localeCompare(b.name);
    });
    
    return sorted;
  }, [customers, favorites, customOrder]);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end - saves new order to localStorage for persistence across app runs
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sortedCustomers.findIndex((c) => c.id === active.id);
      const newIndex = sortedCustomers.findIndex((c) => c.id === over.id);
      
      const newOrder = arrayMove(sortedCustomers, oldIndex, newIndex).map(c => c.id);
      setCustomOrder(newOrder);
      // Persist order immediately to localStorage
      localStorage.setItem('docsmith-customer-order', JSON.stringify(newOrder));
    }
  }

  // Sortable Customer Card Component
  function SortableCustomerCard({ customer }: { customer: Customer }) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: customer.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    return (
      <div ref={setNodeRef} style={style}>
        <Card
          className={
            "group relative overflow-hidden transition-all duration-200 cursor-pointer hover:shadow-lg " +
            (selectedId === customer.id 
              ? "border-primary/70 shadow-md bg-gradient-to-br from-primary/5 to-primary/10" 
              : "hover:border-primary/30 hover:bg-accent/30")
          }
          onClick={() => setSelectedId(customer.id)}
        >
          {/* Selection indicator bar */}
          {selectedId === customer.id && (
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary to-primary/50" />
          )}
          
          <div className="p-2 sm:p-3 md:p-4 pl-3 sm:pl-4 md:pl-5">
          {/* Header: Name and Action Buttons */}
          <div className="flex items-start justify-between gap-1 sm:gap-2 mb-1.5 sm:mb-2">
            <div className="min-w-0 flex-1 flex items-center gap-1 sm:gap-2">
              {/* Drag Handle */}
              <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing touch-none shrink-0"
              >
                <GripVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground hover:text-foreground transition-colors" />
              </div>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      toggleFavorite(customer.id);
                    }}
                    aria-label={favorites.has(customer.id) ? "Remove from favorites" : "Add to favorites"}
                    className="h-5 w-5 sm:h-6 sm:w-6 shrink-0 hover:bg-accent"
                  >
                    <Star 
                      className={`h-3 w-3 sm:h-3.5 sm:w-3.5 ${
                        favorites.has(customer.id) 
                          ? 'fill-yellow-500 text-yellow-500' 
                          : 'text-muted-foreground'
                      }`} 
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {favorites.has(customer.id) ? "Remove from favorites" : "Add to favorites"}
                </TooltipContent>
              </Tooltip>
              <h3 className="text-xs sm:text-sm md:text-base font-semibold truncate text-foreground">
                {customer.name}
              </h3>
            </div>
            
            <div className="flex items-center gap-0.5 sm:gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setConfigCustomerId(customer.id);
                      setSailpointConfigOpen(true);
                    }}
                    aria-label={`SailPoint Settings for ${customer.name}`}
                    className="h-6 w-6 sm:h-7 sm:w-7 hover:bg-accent p-1"
                  >
                    <img 
                      src="/sailpoint-icon.svg" 
                      alt="SailPoint ISC" 
                      className="h-full w-full dark:hidden"
                    />
                    <img 
                      src="/sailpoint-icon-dark.svg" 
                      alt="SailPoint ISC" 
                      className="h-full w-full hidden dark:block"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>SailPoint Configuration</TooltipContent>
              </Tooltip>
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={deleting === customer.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      startDelete(customer);
                    }}
                    aria-label={`Delete ${customer.name}`}
                    className="h-6 w-6 sm:h-7 sm:w-7 hover:bg-destructive/10 hover:text-destructive"
                  >
                    {deleting === customer.name ? (
                      <Loader2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 animate-spin" />
                    ) : (
                      <Icon.Trash className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete Customer</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Compact Metrics */}
          {counts[customer.id]?.embedded == null && counts[customer.id]?.generated == null && counts[customer.id]?.chats == null ? (
            <div className="h-5 sm:h-6 rounded bg-muted/50 animate-pulse w-32 sm:w-48" />
          ) : (
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4 text-xs sm:text-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 sm:gap-1.5">
                    <Upload className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {counts[customer.id]?.embedded ?? "…"}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Embedded Documents</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 sm:gap-1.5">
                    <Sparkles className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {counts[customer.id]?.generated ?? "…"}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Generated Documents</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 sm:gap-1.5">
                    <MessageSquare className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {counts[customer.id]?.chats ?? "…"}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Chat Sessions</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </Card>
      </div>
    );
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

      {/* SailPoint Configuration Modal */}
      <SailpointConfigModal
        customerId={configCustomerId}
        customerName={customers.find(c => c.id === configCustomerId)?.name}
        open={sailpointConfigOpen}
        onOpenChange={(open) => {
          setSailpointConfigOpen(open);
          if (!open) {
            setConfigCustomerId(null);
          }
        }}
      />

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
                  ) : sortedCustomers.length ? (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={sortedCustomers.map(c => c.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-2 sm:space-y-3">
                          {sortedCustomers.map((c) => (
                            <SortableCustomerCard key={c.id} customer={c} />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
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
                  customerId={selectedId}
                  customerName={customers.find(c => c.id === selectedId)?.name}
                  headerActions={(
                    <>
                      <Dialog>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DialogTrigger asChild>
                              <Button size="icon" variant="ghost" aria-label="Recent jobs">
                                <Icon.History className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent>Recent Jobs</TooltipContent>
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
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="ghost" onClick={() => setPanelMode(panelMode === 'chat' ? 'split' : 'chat')} aria-label={panelMode === 'chat' ? 'Collapse chat' : 'Expand chat'}>
                            {panelMode === 'chat' ? (<Minimize2 className="h-4 w-4" />) : (<Maximize2 className="h-4 w-4" />)}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{panelMode === 'chat' ? 'Collapse' : 'Expand'} Chat</TooltipContent>
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
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <TabsTrigger value="uploaded">Uploaded</TabsTrigger>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          Documents uploaded and embedded to the customer workspace
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <TabsTrigger value="generated">Generated</TabsTrigger>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          Documents generated using templates and AI content generation
                        </TooltipContent>
                      </Tooltip>
                    </TabsList>
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder={docsTab === 'uploaded' ? 'Search uploaded documents...' : 'Search generated documents...'}
                        value={docQuery}
                        onChange={(e) => {
                          const value = e.target.value;
                          React.startTransition(() => {
                            setDocQuery(value);
                          });
                          signalUserActivity();
                        }}
                        className="pl-9 h-9 bg-background/50 border-border/50 focus:bg-background"
                      />
                    </div>
                    
                    {/* Context-aware action buttons */}
                    {docsTab === 'uploaded' && (
                      <>
                        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <DialogTrigger asChild>
                                <Button disabled={!selectedId} size="icon" variant="ghost" aria-label="Upload document">
                                  <Icon.Upload className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                            </TooltipTrigger>
                            <TooltipContent>Upload Document</TooltipContent>
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
                        <TooltipTrigger asChild>
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
                        <TooltipContent>Open Uploads Folder</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  
                  {docsTab === 'generated' && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button disabled={!selectedId || hasActiveAIOperation} size="icon" variant="ghost" aria-label="Generate document" onClick={() => setGenerateOpen(true)}>
                            <Icon.FileText className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {hasActiveAIOperation ? 'AI operation in progress' : 'Generate document'}
                        </TooltipContent>
                      </Tooltip>
                      {/* Open documents folder for generated docs */}
                      <Tooltip>
                        <TooltipTrigger asChild>
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
                        <TooltipContent>Open Documents Folder</TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  
                  {/* Expand/Collapse Documents - right most */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="ghost" onClick={() => setPanelMode(panelMode === 'docs' ? 'split' : 'docs')} aria-label={panelMode === 'docs' ? 'Collapse documents' : 'Expand documents'}>
                        {panelMode === 'docs' ? (<Minimize2 className="h-4 w-4" />) : (<Maximize2 className="h-4 w-4" />)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{panelMode === 'docs' ? 'Collapse' : 'Expand'} Documents</TooltipContent>
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
                  ) : filteredUploads.length ? (
                    <ScrollArea className="flex-1 min-h-0 h-full">
                      <div className="px-4 pb-4 space-y-2">
                        {filteredUploads.map((u, idx) => {
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
                                    {uploadMetadataCache.get(u.name)?.isGenerated && (
                                      <Badge className="mt-1 bg-blue-500 text-white hover:bg-blue-600 flex items-center gap-1 w-fit">
                                        <Sparkles className="h-3 w-3" />
                                        Generated
                                      </Badge>
                                    )}
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                      <span>{formatBytes(u.size)}</span>
                                      <span title={new Date(u.modifiedAt).toLocaleString()}>{formatRelativeTime(u.modifiedAt)}</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                    {/* Metadata Button */}
                                    <Tooltip>
                                      <TooltipTrigger asChild>
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
                                              const isGenerated = data.metadata?.extraFields?.isGenerated === true;
                                              setUploadMetadataCache(prev => new Map(prev).set(u.name, { hasMetadata, isGenerated }));
                                              
                                              if (!hasMetadata) {
                                                // No metadata - trigger extraction (only if not generating)
                                                if (!generating) {
                                                  await extractUploadMetadata(u.name);
                                                }
                                              } else {
                                                // Has metadata - show it (allowed even during generation)
                                                setMetadataModal(data.metadata || null);
                                              }
                                            } catch (err) {
                                              console.error('Failed to load metadata:', err);
                                              // If error, try extraction (only if not generating)
                                              if (!generating) {
                                                await extractUploadMetadata(u.name);
                                              }
                                            }
                                          }}
                                          style={
                                            // Hide button if generating AND no metadata
                                            generating && uploadMetadataCache.get(u.name)?.hasMetadata === false
                                              ? { display: 'none' }
                                              : undefined
                                          }
                                        >
                                          {metadataProcessing.has(u.name) ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : uploadMetadataCache.get(u.name)?.hasMetadata === false ? (
                                            <RefreshCw className="h-4 w-4" />
                                          ) : (
                                            <Info className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {metadataProcessing.has(u.name) 
                                          ? 'Extracting metadata...' 
                                          : uploadMetadataCache.get(u.name)?.hasMetadata === false 
                                            ? 'Extract Metadata' 
                                            : 'View Metadata'}
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Download ${u.name}`} onClick={() => { const a = document.createElement('a'); a.href = `/api/uploads/${selectedId}/file?name=${encodeURIComponent(u.name)}`; a.download = u.name; document.body.appendChild(a); a.click(); a.remove(); }}>
                                          <Download className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Download</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
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
                                      <TooltipTrigger asChild>
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
                  ) : filteredGeneratedDocs.length ? (
                    <>
                      {/* Generation Progress Indicator */}
                      {generating && genJobId && (
                        <div className="border-b bg-muted/30 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Icon.Refresh className="h-4 w-4 animate-spin text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium">Generating document...</div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {genProgress != null && genProgress > 0 ? `${genProgress}% complete` : 'Starting generation...'}
                              </div>
                            </div>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              onClick={() => setGenLogs([])}
                              className="shrink-0"
                            >
                              <Eye className="h-3.5 w-3.5 mr-1.5" />
                              View Progress
                            </Button>
                          </div>
                          {genProgress != null && genProgress > 0 && (
                            <div className="mt-2 w-full bg-muted rounded-full h-1.5 overflow-hidden">
                              <div 
                                className="bg-primary h-full transition-all duration-300 ease-out"
                                style={{ width: `${genProgress}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <ScrollArea className="flex-1 min-h-0 h-full">
                        <div className="px-4 pb-4 space-y-2">
                          {filteredGeneratedDocs.map((d, idx) => {
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
                                      {uploadedGenDocs.has(d.name) && (
                                        <Badge variant="default" className="mt-1">
                                          In Workspace
                                        </Badge>
                                      )}
                                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                        <span>{formatBytes(d.size)}</span>
                                        <span title={new Date(d.modifiedAt).toLocaleString()}>{formatRelativeTime(d.modifiedAt)}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button 
                                            size="icon" 
                                            variant="ghost" 
                                            className="h-9 w-9" 
                                            aria-label="Upload to Workspace" 
                                            disabled={uploadingGenDoc && uploadGenDocName === d.name || uploadedGenDocs.has(d.name)}
                                            onClick={() => embedGeneratedDoc(d.name)}
                                          >
                                            {uploadingGenDoc && uploadGenDocName === d.name ? (
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                              <Upload className="h-4 w-4" />
                                            )}
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          {uploadedGenDocs.has(d.name) ? 'Already in Workspace' : 'Upload to Workspace'}
                                        </TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Regenerate with Revisions" onClick={async () => { 
                                            setRegenerateDoc({ name: d.name, customerId: selectedId });
                                            // Fetch job info
                                            try {
                                              const jobsResponse = await apiFetch('/api/generate/jobs');
                                              const jobsData = await jobsResponse.json();
                                              const jobs = Array.isArray(jobsData?.jobs) ? jobsData.jobs : [];
                                              const matchingJob = jobs.find((j: any) => 
                                                j.customerId === selectedId && 
                                                j.file?.name === d.name &&
                                                j.status === 'done'
                                              );
                                              if (matchingJob) {
                                                setRegenerateDocJobInfo({
                                                  template: matchingJob.template,
                                                  instructions: matchingJob.instructions,
                                                  pinnedDocuments: matchingJob.pinnedDocuments
                                                });
                                              }
                                            } catch (err) {
                                              console.error('Failed to fetch job info:', err);
                                            }
                                            setRegenerateOpen(true); 
                                          }}>
                                            <RefreshCw className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Regenerate with Revisions</TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Download ${d.name}`} onClick={() => { const a = document.createElement('a'); a.href = `/api/documents/${selectedId}/file?name=${encodeURIComponent(d.name)}`; a.download = d.name; document.body.appendChild(a); a.click(); a.remove(); }}>
                                            <Download className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Download</TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button size="icon" variant="destructive" className="h-9 w-9" disabled={deletingGenDoc && deleteGenDocName === d.name} onClick={() => { setDeleteGenDocName(d.name); setDeleteGenDocOpen(true); }} aria-label={`Delete ${d.name}`}>
                                            {deletingGenDoc && deleteGenDocName === d.name ? '...' : <Icon.Trash className="h-4 w-4" />}
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
                    </>
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
        <DialogContent className="w-[95vw] sm:!max-w-6xl overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Generate Document</DialogTitle>
            <DialogDescription>
              Select template and documents to include in generation.
            </DialogDescription>
          </DialogHeader>
          
          {/* Two-column layout: 1/3 left, 2/3 right */}
          <div className="grid grid-cols-[1fr,2fr] gap-6">
            {/* Left column - Template selection and instructions */}
            <div className="space-y-4">
              {/* Template Selection */}
              <div>
                <label className="text-sm font-medium mb-2 block">Template</label>
                {loadingTemplates ? (
                  <div className="border rounded-md h-9 px-3 flex items-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading templates...
                  </div>
                ) : templates.length === 0 ? (
                  <div className="border rounded-md h-9 px-3 flex items-center text-sm text-muted-foreground">
                    No templates found
                  </div>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="text"
                        placeholder="Search templates..."
                        className="pl-8 h-9"
                        value={genTemplateQuery}
                        onChange={(e) => {
                          const value = e.target.value;
                          React.startTransition(() => {
                            setGenTemplateQuery(value);
                          });
                          signalUserActivity();
                        }}
                        disabled={generating}
                      />
                    </div>
                    <Select value={selectedTemplate} onValueChange={setSelectedTemplate} disabled={generating}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a template">
                          {selectedTemplate && (() => {
                            const t = templates.find(tmpl => tmpl.slug === selectedTemplate);
                            return t ? (
                              <div className="flex items-center gap-2">
                                <span>{t.name || t.slug}</span>
                                {!t.hasFullGen && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <AlertCircle className="h-4 w-4 text-amber-500" />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Template not compiled yet</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </div>
                            ) : null;
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {filteredTemplates.length === 0 ? (
                          <div className="p-2 text-sm text-muted-foreground text-center">
                            No templates match your search
                          </div>
                        ) : (
                          filteredTemplates.map((t) => (
                            <SelectItem key={t.slug} value={t.slug}>
                              <div className="flex items-center gap-2">
                                <span>{t.name || t.slug}</span>
                                {!t.hasFullGen && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <AlertCircle className="h-4 w-4 text-amber-500" />
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Template not compiled yet</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    
                    {/* Warning for uncompiled templates */}
                    {selectedTemplate && (() => {
                      const t = templates.find(tmpl => tmpl.slug === selectedTemplate);
                      return t && !t.hasFullGen ? (
                        <div className="mt-2 flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
                          <div className="text-sm text-amber-800 dark:text-amber-400">
                            This template has not been compiled yet. Please compile it in the Templates page before generating documents.
                          </div>
                        </div>
                      ) : null;
                    })()}
                    
                    {/* Estimated generation time */}
                    {selectedTemplate && (() => {
                      const t = templates.find(tmpl => tmpl.slug === selectedTemplate);
                      return t?.avgGenerationTimeFormatted && t.hasFullGen ? (
                        <div className="mt-2 flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-muted">
                          <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium">Estimated time:</span> {t.avgGenerationTimeFormatted}
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </>
                )}
              </div>
              
              {/* Additional Instructions */}
              <div>
                <label className="text-sm font-medium mb-1 block">Additional Instructions (optional)</label>
                <Textarea
                  className="w-full min-h-[400px]"
                  placeholder="e.g., focus on Q3 data, keep it concise, etc."
                  value={genInstructions}
                  onChange={(e) => setGenInstructions(e.target.value)}
                  disabled={generating}
                />
              </div>
              
              {generating && (
                <div className="pt-2"><Progress indeterminate /></div>
              )}
            </div>
            
            {/* Right column - Document selection */}
            {selectedTemplate && (
              <div className="border-l pl-6 flex flex-col min-h-[400px]">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">
                    Documents ({genPinnedDocs.size}/3)
                  </label>
                  {genDocuments.length > 0 && (
                    <div className="flex gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => {
                              const topDocs = genDocuments
                                .sort((a, b) => b.relevance - a.relevance)
                                .slice(0, 3)
                                .map(d => d.name);
                              setGenPinnedDocs(new Set(topDocs));
                            }}
                            disabled={generating}
                          >
                            <span className="text-xs">Top 3</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Select top 3 most relevant</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => setGenPinnedDocs(new Set())}
                            disabled={generating || genPinnedDocs.size === 0}
                          >
                            <span className="text-xs">Clear</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Clear all selections</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
                
                {genPinnedDocs.size >= 3 && (
                  <div className="mb-2 text-xs text-muted-foreground bg-muted/50 border border-border rounded-md px-2 py-1.5 flex items-center gap-1">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    <span>Max 3 documents</span>
                  </div>
                )}
                
                {/* Search field */}
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search..."
                    className="pl-7 h-8 text-sm"
                    value={genDocQuery}
                    onChange={(e) => {
                      const value = e.target.value;
                      React.startTransition(() => {
                        setGenDocQuery(value);
                      });
                      signalUserActivity();
                    }}
                    disabled={generating}
                  />
                </div>
                
                <div className="border rounded-md overflow-hidden flex-1">
                  <ScrollArea className="h-full">
                    {loadingGenDocs ? (
                      <div className="p-4 text-sm text-muted-foreground text-center">
                        Loading relevance scores...
                      </div>
                    ) : genDocuments.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground text-center">
                        No documents with metadata found
                      </div>
                    ) : filteredGenDocuments.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground text-center">
                        No matches
                      </div>
                    ) : (
                      <div className="divide-y">
                        {filteredGenDocuments.map((doc) => {
                            const isPinned = genPinnedDocs.has(doc.name);
                            const scoreColor = doc.relevance >= 8 ? 'text-green-600' : doc.relevance >= 6 ? 'text-yellow-600' : 'text-gray-500';
                            const canPin = isPinned || genPinnedDocs.size < 3;
                            
                            return (
                              <div key={doc.name} className="p-2.5 hover:bg-muted/50 transition">
                                <div className="flex items-start gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant={isPinned ? "default" : "outline"}
                                        className="h-7 w-7 shrink-0"
                                        onClick={() => {
                                          setGenPinnedDocs(prev => {
                                            const next = new Set(prev);
                                            if (isPinned) {
                                              next.delete(doc.name);
                                            } else if (next.size < 3) {
                                              next.add(doc.name);
                                            }
                                            return next;
                                          });
                                        }}
                                        disabled={generating || (!isPinned && !canPin)}
                                      >
                                        <Pin className={`h-3 w-3 ${isPinned ? 'fill-current' : ''}`} />
                                      </Button>
                                    </TooltipTrigger>
                                    {!canPin && (
                                      <TooltipContent>Maximum 3 documents</TooltipContent>
                                    )}
                                  </Tooltip>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <span className="text-sm font-medium truncate">{doc.name}</span>
                                      <Badge variant="outline" className={`text-xs shrink-0 ${scoreColor}`}>
                                        {doc.relevance.toFixed(1)}
                                      </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                      {doc.reasoning}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="secondary" onClick={() => setGenerateOpen(false)} disabled={generating}>Cancel</Button>
            <Button 
              onClick={handleGenerateClick} 
              disabled={
                !selectedId || 
                !selectedTemplate || 
                generating ||
                (() => {
                  const t = templates.find(tmpl => tmpl.slug === selectedTemplate);
                  return t && !t.hasFullGen;
                })()
              } 
              aria-label="Confirm generate"
            >
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No Documents Warning Dialog */}
      <AlertDialog open={showNoDocsWarning} onOpenChange={setShowNoDocsWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No Documents Selected</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              You haven't selected any specific documents. The workspace will automatically determine which content to use based on the AI conversation context.
            </p>
            <p className="text-sm text-muted-foreground mt-3">
              <strong>Note:</strong> This may not include all relevant information. For best results, select up to 3 documents with the highest relevance scores.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={proceedWithoutDocs}>
              Continue Without Documents
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        disableRetry={generating}
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

      {/* Regenerate Dialog */}
      <Dialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Regenerate Document with Revisions</DialogTitle>
            <DialogDescription>
              Add revision instructions to improve or fix the generated document. The AI will maintain the original workspace context.
            </DialogDescription>
          </DialogHeader>

          {regenerateDoc && (
            <div className="space-y-4">
              {/* Document Details */}
              <div className="space-y-2 text-sm">
                {regenerateDocJobInfo?.template && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Template:</span>
                    <code className="px-2 py-0.5 bg-muted rounded">{regenerateDocJobInfo.template}</code>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Customer:</span>
                  <span>{customers.find(c => c.id === selectedId)?.name || `Customer ${selectedId}`}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Document:</span>
                  <code className="px-2 py-0.5 bg-muted rounded text-xs">{regenerateDoc.name}</code>
                </div>
              </div>

              {/* Original Instructions (if any) */}
              {regenerateDocJobInfo?.instructions && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Original Instructions</label>
                  <div className="p-3 bg-muted rounded-md text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {regenerateDocJobInfo.instructions}
                  </div>
                </div>
              )}

              {/* Revision Instructions Input */}
              <div className="space-y-2">
                <label htmlFor="revision-instructions" className="text-sm font-medium">
                  Revision Instructions {!regenerateDocJobInfo?.instructions && <span className="text-muted-foreground">(required)</span>}
                </label>
                <Textarea
                  id="revision-instructions"
                  placeholder="Describe the changes needed (e.g., 'Fix table 2 formatting', 'Add executive summary section', 'Update conclusion with new data')..."
                  value={revisionInstructions}
                  onChange={(e) => setRevisionInstructions(e.target.value)}
                  rows={6}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  The AI will use the same workspace context and documents as the original generation.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setRegenerateOpen(false); setRevisionInstructions(''); setRegenerateDocJobInfo(null); }} disabled={regenerating}>
              Cancel
            </Button>
            <Button onClick={handleRegenerate} disabled={regenerating || !revisionInstructions.trim()}>
              {regenerating ? 'Regenerating...' : 'Regenerate Document'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Generated Document Confirmation */}
      <AlertDialog open={deleteGenDocOpen} onOpenChange={setDeleteGenDocOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Generated Document?</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="py-3">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <span className="font-medium text-foreground">{deleteGenDocName}</span>?
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              This action cannot be undone. The file will be permanently removed from disk.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingGenDoc}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteGeneratedDoc} 
              disabled={deletingGenDoc}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingGenDoc ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CustomersPage;

function RecentJobs({ selectedId }: { selectedId: number | null }) {
  const [jobs, setJobs] = React.useState<Array<any>>([])
  const [loading, setLoading] = React.useState(false)
  const [active, setActive] = React.useState<any | null>(null)
  const [isUserActive] = useUserActivity(1000);

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

  // Pause polling during user input to improve text input responsiveness
  React.useEffect(() => {
    let ignore = false
    const load = async () => {
      // Skip polling if user is actively typing
      if (isUserActive) return;
      
      try {
        setLoading(true)
        const r = await apiFetch('/api/generate/jobs')
        const j = await r.json().catch(() => ({}))
        if (!ignore) {
          const arr = Array.isArray(j?.jobs) ? j.jobs : []
          
          // Only update state if jobs actually changed (prevent unnecessary re-renders)
          setJobs(prev => {
            if (prev.length !== arr.length) return arr;
            const changed = arr.some((job: any, idx: number) => {
              const prevJob = prev[idx];
              return !prevJob || prevJob.id !== job.id || prevJob.status !== job.status;
            });
            return changed ? arr : prev;
          });
          
          const filtered = selectedId ? arr.filter((x: any) => x.customerId === selectedId) : arr
          if (!active && filtered.length) { try { await openJob(filtered[0].id) } catch { } }
        }
      } catch { if (!ignore) setJobs([]) } finally { if (!ignore) setLoading(false) }
    }
    load()
    const t = setInterval(load, 5000)
    return () => { ignore = true; clearInterval(t) }
  }, [selectedId, isUserActive])

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




