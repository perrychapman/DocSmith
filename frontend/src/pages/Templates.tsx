import * as React from "react";
import { renderAsync } from "docx-preview";
import JSZip from "jszip";
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
import { Search, FileText as FileTextIcon, FileSpreadsheet, FileCode, CheckCircle2, AlertTriangle, Loader2, Sparkles, Copy, X, ExternalLink, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, apiEventSource } from '../lib/api';

type TItem = { slug: string; name?: string; dir?: string; hasTemplate?: boolean; hasDocx?: boolean; hasExcel?: boolean; hasSource?: boolean; hasFullGen?: boolean; compiledAt?: string; workspaceSlug?: string; updatedAt?: string; versionCount?: number };

type CompileStatus = 'idle' | 'running' | 'success' | 'error';
type CompileState = { status: CompileStatus; startedAt?: number; finishedAt?: number; error?: string };
type CompileStateMap = Record<string, CompileState>;

// Document metadata extracted from DOCX
interface DocxMetadata {
  pageWidth?: string;
  pageHeight?: string;
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
  orientation?: 'portrait' | 'landscape';
  defaultFont?: string;
  defaultSize?: string;
}

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
  const [docxData, setDocxData] = React.useState<ArrayBuffer | null>(null);
  const [docxMetadata, setDocxMetadata] = React.useState<DocxMetadata | null>(null);
  const docxPreviewRef = React.useRef<HTMLDivElement | null>(null);
  const viewerScrollRef = React.useRef<HTMLDivElement | null>(null);
  
  // PDF viewer controls
  const [currentPage, setCurrentPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [zoomLevel, setZoomLevel] = React.useState(100);
  const [pageElements, setPageElements] = React.useState<Element[]>([]);

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

  // Extract document metadata from DOCX file
  async function extractDocxMetadata(arrayBuffer: ArrayBuffer): Promise<DocxMetadata> {
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      // Try to get document.xml to parse section properties
      const documentXml = await zip.file('word/document.xml')?.async('text');
      
      const metadata: DocxMetadata = {};
      
      // Parse document.xml for page setup (most reliable source)
      if (documentXml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(documentXml, 'text/xml');
        
        // Get page size and margins from section properties
        const sectPr = doc.querySelector('sectPr');
        if (sectPr) {
          const pgSz = sectPr.querySelector('pgSz');
          if (pgSz) {
            const width = pgSz.getAttribute('w:w');
            const height = pgSz.getAttribute('w:h');
            const orient = pgSz.getAttribute('w:orient');
            
            // Convert twips to pixels (1440 twips = 1 inch, 96 DPI)
            if (width) {
              const widthInches = parseInt(width) / 1440;
              metadata.pageWidth = `${widthInches}in`;
              console.log(`Page width: ${widthInches}in`);
            }
            if (height) {
              const heightInches = parseInt(height) / 1440;
              metadata.pageHeight = `${heightInches}in`;
              console.log(`Page height: ${heightInches}in`);
            }
            metadata.orientation = orient === 'landscape' ? 'landscape' : 'portrait';
          }
          
          const pgMar = sectPr.querySelector('pgMar');
          if (pgMar) {
            const top = pgMar.getAttribute('w:top');
            const bottom = pgMar.getAttribute('w:bottom');
            const left = pgMar.getAttribute('w:left');
            const right = pgMar.getAttribute('w:right');
            
            if (top) {
              const topInches = parseInt(top) / 1440;
              metadata.marginTop = `${topInches}in`;
              console.log(`Margin top: ${topInches}in`);
            }
            if (bottom) {
              const bottomInches = parseInt(bottom) / 1440;
              metadata.marginBottom = `${bottomInches}in`;
              console.log(`Margin bottom: ${bottomInches}in`);
            }
            if (left) {
              const leftInches = parseInt(left) / 1440;
              metadata.marginLeft = `${leftInches}in`;
              console.log(`Margin left: ${leftInches}in`);
            }
            if (right) {
              const rightInches = parseInt(right) / 1440;
              metadata.marginRight = `${rightInches}in`;
              console.log(`Margin right: ${rightInches}in`);
            }
          }
        }
      }
      
      // Parse styles.xml for default font
      const stylesXml = await zip.file('word/styles.xml')?.async('text');
      if (stylesXml) {
        const parser = new DOMParser();
        const stylesDoc = parser.parseFromString(stylesXml, 'text/xml');
        
        const defaultFont = stylesDoc.querySelector('docDefaults rPrDefault rPr rFonts');
        if (defaultFont) {
          const asciiFont = defaultFont.getAttribute('w:ascii');
          if (asciiFont) {
            metadata.defaultFont = asciiFont;
            console.log(`Default font: ${asciiFont}`);
          }
        }
        
        const defaultSize = stylesDoc.querySelector('docDefaults rPrDefault rPr sz');
        if (defaultSize) {
          const size = defaultSize.getAttribute('w:val');
          // Font size in Word is in half-points, convert to points
          if (size) {
            const sizePoints = parseInt(size) / 2;
            metadata.defaultSize = `${sizePoints}pt`;
            console.log(`Default size: ${sizePoints}pt`);
          }
        }
      }
      
      console.log('Extracted DOCX metadata:', metadata);
      return metadata;
    } catch (error) {
      console.error('Failed to extract DOCX metadata:', error);
      return {};
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
    setPreviewLoading(true);
    setPreviewContent(null);
    setPreviewType(null);
    setPreviewSource(null);
    setDocxData(null);
    
    try {
      // For text-based templates, fetch the preview
      const r = await apiFetch(`/api/templates/${encodeURIComponent(slug)}/preview`);
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}));
        console.error('Preview failed:', r.status, errorData);
        throw new Error(errorData.error || String(r.status));
      }
      const data = await r.json();
      console.log('Preview data received:', data);
      
      // Handle binary files (DOCX/XLSX)
      if (data.type === 'binary') {
        console.log('Binary file detected:', data.format, data.downloadUrl);
        
        // For Excel files, show a message and don't show preview
        if (data.format === 'xlsx') {
          toast.error?.('Excel preview not yet supported. Please download the template to view it.');
          setPreviewLoading(false);
          setSelectedSlug(null);
          return;
        }
        
        setPreviewType('binary');
        setPreviewSource(data.downloadUrl);
        setPreviewContent(data.format);
        
        // For DOCX files, fetch the data for rendering
        if (data.format === 'docx' && data.downloadUrl) {
          try {
            console.log('Fetching DOCX file from:', data.downloadUrl);
            const docxResponse = await fetch(data.downloadUrl);
            const docxBlob = await docxResponse.blob();
            const docxArrayBuffer = await docxBlob.arrayBuffer();
            console.log('DOCX file loaded, size:', docxArrayBuffer.byteLength, 'bytes');
            
            // Extract metadata from the DOCX file
            const metadata = await extractDocxMetadata(docxArrayBuffer);
            setDocxMetadata(metadata);
            setDocxData(docxArrayBuffer);
          } catch (fetchError) {
            console.error('DOCX fetch failed:', fetchError);
            toast.error?.('Failed to load document preview.');
            setSelectedSlug(null);
          }
        }
      }
      // Handle HTML response
      else if (data.html) {
        console.log('Setting HTML content, length:', data.html.length);
        setPreviewContent(data.html);
        setPreviewType('html');
        setPreviewSource(data.source || 'template');
      } 
      // Handle text response (wrap in pre tag for proper formatting)
      else if (data.text) {
        console.log('Setting text content, length:', data.text.length);
        setPreviewContent(`<pre class="whitespace-pre-wrap font-mono text-sm">${escapeHtml(data.text)}</pre>`);
        setPreviewType('text');
        setPreviewSource(data.source || 'template');
      } 
      else {
        console.warn('No html or text in preview response:', data);
        setPreviewContent(null);
        setPreviewType(null);
        setPreviewSource(null);
      }
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

  // Page navigation functions
  function goToPage(pageNum: number) {
    if (pageNum < 1 || pageNum > totalPages) return;
    
    if (pageElements.length > 0 && pageElements[pageNum - 1]) {
      pageElements[pageNum - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrentPage(pageNum);
    } else if (viewerScrollRef.current) {
      // Fallback: estimate scroll position based on page number
      const pageHeight = 11 * 96 + 24; // 11in * 96dpi + margin
      const scrollTop = (pageNum - 1) * pageHeight;
      viewerScrollRef.current.scrollTo({ top: scrollTop, behavior: 'smooth' });
      setCurrentPage(pageNum);
    }
  }

  function handleZoom(direction: 'in' | 'out' | 'reset') {
    if (direction === 'reset') {
      setZoomLevel(100);
    } else if (direction === 'in') {
      setZoomLevel(prev => Math.min(prev + 10, 200));
    } else {
      setZoomLevel(prev => Math.max(prev - 10, 50));
    }
  }

  // Effect to render DOCX when data is available and ref is mounted
  React.useEffect(() => {
    if (docxData && docxPreviewRef.current && previewType === 'binary' && previewContent === 'docx') {
      const container = docxPreviewRef.current;
      
      // Clear previous content
      container.innerHTML = '';
      
      // Reset page controls
      setCurrentPage(1);
      setTotalPages(1);
      setZoomLevel(100);
      
      // Render DOCX with all formatting preserved including page breaks
      renderAsync(docxData, container, undefined, {
        className: 'docx',            // Use docx class for library styling
        inWrapper: false,             // Don't wrap - let sections be direct children
        ignoreWidth: false,           // Preserve document width
        ignoreHeight: false,          // Preserve document height
        ignoreFonts: false,           // Use document's fonts
        breakPages: true,             // Render page breaks
        ignoreLastRenderedPageBreak: false,  // Include all page breaks
        experimental: true,           // Enable experimental features for better page break detection
        trimXmlDeclaration: true,
        useBase64URL: false,          // Use blob URLs for better performance
        renderHeaders: true,          // Include headers
        renderFooters: true,          // Include footers
        renderFootnotes: true,        // Include footnotes
        renderEndnotes: true,         // Include endnotes
        debug: false
      })
        .then(() => {
          console.log('DOCX preview rendered successfully');
          
          // First, try to find explicit section/page markers
          let sections: NodeListOf<Element> | Element[] = container.querySelectorAll('section.docx');
          
          if (sections.length === 0) {
            sections = container.querySelectorAll('section');
          }
          
          if (sections.length === 0) {
            sections = container.querySelectorAll('article');
          }
          
          // If we found explicit sections, use them
          if (sections.length > 0) {
            console.log('Found explicit page sections:', sections.length);
            setTotalPages(sections.length);
            setPageElements(Array.from(sections));
            
            // Add page number attributes
            sections.forEach((section, index) => {
              section.setAttribute('data-page-number', String(index + 1));
            });
          } else {
            // No explicit sections - we have continuous content
            // Calculate pages based on document height and page height from metadata
            console.log('No explicit sections found, calculating pages from content height');
            
            const pageHeightStr = docxMetadata?.pageHeight || '11in';
            const pageHeightInches = parseFloat(pageHeightStr);
            const pageHeightPx = pageHeightInches * 96; // 96 DPI
            
            const contentHeight = container.scrollHeight;
            const calculatedPages = Math.ceil(contentHeight / pageHeightPx);
            
            console.log('Content height:', contentHeight, 'px');
            console.log('Page height:', pageHeightPx, 'px');
            console.log('Calculated pages:', calculatedPages);
            
            // Create virtual page markers by wrapping content in sections
            if (calculatedPages > 1) {
              const allContent = container.innerHTML;
              container.innerHTML = ''; // Clear container
              
              // Create sections for each page based on height
              for (let i = 0; i < calculatedPages; i++) {
                const section = document.createElement('section');
                section.className = 'docx-page';
                section.setAttribute('data-page-number', String(i + 1));
                section.style.minHeight = `${pageHeightPx}px`;
                
                // For first page, add all content (it will flow naturally)
                if (i === 0) {
                  section.innerHTML = allContent;
                }
                
                container.appendChild(section);
              }
              
              const newSections = container.querySelectorAll('section.docx-page');
              setTotalPages(newSections.length);
              setPageElements(Array.from(newSections));
            } else {
              // Single page document
              setTotalPages(1);
              setPageElements([container]);
            }
          }
          
          const pageCount = sections.length || 1;
          console.log('Page count:', pageCount, 'sections found');
          setTotalPages(pageCount);
          setPageElements(Array.from(sections));
          
          // Add page number attributes
          sections.forEach((section, index) => {
            section.setAttribute('data-page-number', String(index + 1));
          });
        })
        .catch((renderError) => {
          console.error('DOCX rendering failed:', renderError);
          toast.error?.('Unable to preview this document. Please download it to view in Word.');
          // Close preview on error
          setSelectedSlug(null);
        });
    }
  }, [docxData, previewType, previewContent]);

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
          <Button variant="secondary" onClick={load}><Icon.Refresh className="h-4 w-4 mr-2" />Refresh</Button>
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
                      const anyCompileInFlight = Boolean(compiling);
                      const disableCompileButton = isCompiling || (anyCompileInFlight && !isActiveCompile);
                      const compileLabel = isCompiling ? 'Compiling...' : (hadError ? 'Retry compile' : (hasCompiled ? 'Recompile' : 'Compile'));
                      const compileActionLabel = isCompiling ? 'Compiling template' : (hadError ? 'Retry compile for template' : (hasCompiled ? 'Recompile template' : 'Compile template'));
                      const compileTooltip = isCompiling ? 'Compilation running...' : (hadError ? 'Last attempt failed - try again' : (hasCompiled ? 'Generate a fresh FullGen script' : 'Create the FullGen script'));
                      
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
                              <div className="flex items-center justify-between gap-3">
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
                                <div className="flex items-center gap-1 sm:gap-2 shrink-0">
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
          {selectedSlug ? (() => {
            const selectedTemplate = items.find(t => t.slug === selectedSlug);
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
                ) : previewType === 'binary' && previewSource ? (
                  <div className="h-full flex flex-col bg-muted/5">
                    {/* PDF-style toolbar */}
                    <div className="px-4 py-2 border-b border-border/40 bg-background/95 backdrop-blur">
                      <div className="flex items-center justify-between gap-6">
                        {/* Left: Document name */}
                        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                          <FileTextIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm text-foreground truncate whitespace-nowrap">
                            {selectedTemplate?.name || 'Document Preview'}
                          </span>
                        </div>
                        
                        {/* Center: Page controls and zoom */}
                        {previewContent === 'docx' && (
                          <div className="flex items-center gap-6 flex-shrink-0">
                            {/* Page navigation */}
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => goToPage(currentPage - 1)}
                                disabled={currentPage <= 1}
                                className="h-8 w-8 p-0"
                              >
                                <ChevronLeft className="h-5 w-5" />
                              </Button>
                              <div className="flex items-center gap-2">
                                <Input
                                  type="number"
                                  min={1}
                                  max={totalPages}
                                  value={currentPage}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '') return;
                                    const page = parseInt(val);
                                    if (!isNaN(page)) {
                                      goToPage(page);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const page = parseInt(e.currentTarget.value);
                                      if (!isNaN(page)) {
                                        goToPage(page);
                                      }
                                    }
                                  }}
                                  className="h-8 w-14 text-center text-sm"
                                />
                                <span className="text-sm text-muted-foreground whitespace-nowrap">of {totalPages}</span>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => goToPage(currentPage + 1)}
                                disabled={currentPage >= totalPages}
                                className="h-8 w-8 p-0"
                              >
                                <ChevronRight className="h-5 w-5" />
                              </Button>
                            </div>
                            
                            {/* Zoom controls */}
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleZoom('out')}
                                disabled={zoomLevel <= 50}
                                className="h-8 w-8 p-0"
                              >
                                <Minus className="h-5 w-5" />
                              </Button>
                              <span className="text-sm text-muted-foreground min-w-[3.5rem] text-center tabular-nums whitespace-nowrap">
                                {zoomLevel}%
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleZoom('in')}
                                disabled={zoomLevel >= 200}
                                className="h-8 w-8 p-0"
                              >
                                <Plus className="h-5 w-5" />
                              </Button>
                            </div>
                          </div>
                        )}
                        
                        {/* Right: Download button */}
                        <div className="flex items-center flex-shrink-0">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                              const a = document.createElement('a');
                              a.href = previewSource;
                              a.download = `${selectedTemplate?.slug || 'template'}.${previewContent}`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                            }}
                            className="h-7 px-3 whitespace-nowrap"
                          >
                            <Icon.Download className="h-4 w-4 mr-1.5" />
                            Download
                          </Button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Document viewer area */}
                    <div 
                      ref={viewerScrollRef}
                      className="flex-1 overflow-auto" 
                      style={{ backgroundColor: '#525659' }}
                    >
                      {previewContent === 'docx' ? (
                        <div className="min-h-full flex justify-center py-8 px-4">
                          <div 
                            className="docx-viewer-container transition-transform duration-200"
                            style={{
                              transform: `scale(${zoomLevel / 100})`,
                              transformOrigin: 'top center',
                              // Apply document metadata as CSS custom properties for dynamic styling
                              ...(docxMetadata?.pageWidth && { '--docx-page-width': docxMetadata.pageWidth } as any),
                              ...(docxMetadata?.pageHeight && { '--docx-page-height': docxMetadata.pageHeight } as any),
                              ...(docxMetadata?.marginTop && { '--docx-margin-top': docxMetadata.marginTop } as any),
                              ...(docxMetadata?.marginBottom && { '--docx-margin-bottom': docxMetadata.marginBottom } as any),
                              ...(docxMetadata?.marginLeft && { '--docx-margin-left': docxMetadata.marginLeft } as any),
                              ...(docxMetadata?.marginRight && { '--docx-margin-right': docxMetadata.marginRight } as any),
                              ...(docxMetadata?.defaultFont && { '--docx-default-font': docxMetadata.defaultFont } as any),
                              ...(docxMetadata?.defaultSize && { '--docx-default-size': docxMetadata.defaultSize } as any),
                            }}
                          >
                            <div ref={docxPreviewRef} />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full p-8">
                          <div className="text-center space-y-3">
                            <FileSpreadsheet className="h-16 w-16 mx-auto text-green-600 opacity-50" />
                            <div className="text-sm text-muted-foreground max-w-md">
                              Excel preview not yet supported.
                              <br />
                              Please download the file to view it in Excel.
                            </div>
                          </div>
                        </div>
                      )}
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
    </div>
  );
}



