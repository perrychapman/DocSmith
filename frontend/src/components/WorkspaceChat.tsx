import * as React from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card } from "./ui/card";
import { Button } from "./ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Textarea } from "./ui/textarea";
import { Icon } from "./icons";
import { toast } from "sonner";
import { A, apiFetch } from "../lib/api";
import { readSSEStream, formatTimeAgo } from "../lib/utils";
import { Copy, Check, Download, FileText } from "lucide-react";
import { useUserActivity } from "../lib/hooks";

type Thread = { id?: number; slug?: string; name?: string };

type ExternalCard = {
  id: string;
  side?: 'user' | 'assistant';
  template?: string;
  jobId?: string;
  jobStatus?: 'running'|'done'|'error'|'cancelled';
  filename?: string;
  aiContext?: string;
  timestamp?: number;
};

type Props = {
  slug: string;
  title?: string;
  className?: string;
  headerActions?: React.ReactNode;
  externalCards?: ExternalCard[];
  onOpenLogs?: (jobId: string) => void;
  onOpenGenerate?: () => void;
  customerId?: number; // For SailPoint integration
  customerName?: string; // For displaying in SailPoint responses
};

export default function WorkspaceChat({ slug, title = "AI Chat", className, headerActions, externalCards, onOpenLogs, onOpenGenerate, customerId, customerName }: Props) {
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [threadSlug, setThreadSlug] = React.useState<string | undefined>(undefined);
  const [history, setHistory] = React.useState<any[]>([]);
  
  // PERFORMANCE: Use uncontrolled input with ref for instant typing without re-renders
  const messageInputRef = React.useRef<HTMLTextAreaElement>(null);
  
  const [loading, setLoading] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  const [stream] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [streamingProgress, setStreamingProgress] = React.useState<string>(''); // Current progress status
  
  // Pagination state
  const [hasMore, setHasMore] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const MESSAGES_PER_PAGE = 20;
  // PERFORMANCE: Reduced from 100 to 50 to minimize DOM nodes and improve rendering
  const MAX_MESSAGES_IN_VIEW = 50; // Limit displayed messages to prevent performance issues
  
  // Jobs for this workspace (UI-only correlation to hide codey outputs)
  type Job = {
    id: string;
    customerId: number;
    customerName?: string;
    template: string;
    filename?: string;
    usedWorkspace?: string;
    startedAt: string;
    updatedAt: string;
    completedAt?: string;
    status: 'running'|'done'|'error'|'cancelled';
    file?: { path: string; name: string };
    error?: string;
  };
  const [wsJobs, setWsJobs] = React.useState<Job[]>([]);
  const injectedRef = React.useRef<Record<string, number>>({});
  const [isUserActive, signalActivity] = useUserActivity(1000);

  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = React.useState(true);
  const scrollAnimationRef = React.useRef<number | null>(null);
  const autoScrollTimeoutRef = React.useRef<number | null>(null);
  const activeStreamRef = React.useRef<boolean>(false); // Track active stream to prevent aborts
  const activeResponseRef = React.useRef<Response | null>(null); // Keep response alive during streaming
  
  const scrollToBottom = React.useCallback((smooth = true) => {
    const el = listRef.current; 
    if (!el) return;
    
    // Cancel any ongoing scroll animation
    if (scrollAnimationRef.current) {
      cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = null;
    }
    
    const target = el.scrollHeight - el.clientHeight;
    
    if (!smooth) {
      el.scrollTop = target;
      return;
    }
    
    // Custom smooth scroll implementation for better cross-browser support
    const start = el.scrollTop;
    const duration = 150; // Faster for streaming (150ms vs 300ms)
    const startTime = performance.now();
    
    const animateScroll = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function for smooth animation
      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      
      el.scrollTop = start + (target - start) * easeOutCubic;
      
      if (progress < 1) {
        scrollAnimationRef.current = requestAnimationFrame(animateScroll);
      } else {
        scrollAnimationRef.current = null;
      }
    };
    
    scrollAnimationRef.current = requestAnimationFrame(animateScroll);
  }, []);

  // Debounced auto-scroll for streaming - only scrolls if user is at bottom
  const scheduleAutoScroll = React.useCallback(() => {
    if (!atBottom) return;
    
    // Clear any pending auto-scroll
    if (autoScrollTimeoutRef.current) {
      clearTimeout(autoScrollTimeoutRef.current);
    }
    
    // Schedule a scroll after a short delay to batch rapid updates
    autoScrollTimeoutRef.current = window.setTimeout(() => {
      const el = listRef.current;
      if (!el) return;
      
      // Check if user is still near bottom (within 100px)
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (isNearBottom) {
        // Just snap to bottom without animation during streaming
        el.scrollTop = el.scrollHeight;
      }
      autoScrollTimeoutRef.current = null;
    }, 50); // 50ms debounce
  }, [atBottom]);

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (autoScrollTimeoutRef.current) {
        clearTimeout(autoScrollTimeoutRef.current);
      }
    };
  }, []);
  const onListScroll = React.useCallback(() => {
    const el = listRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    setAtBottom(near);
    
    // Load more messages when scrolling to top
    if (el.scrollTop < 100 && hasMore && !loadingMore) {
      loadMoreMessages();
    }
  }, [hasMore, loadingMore]);

  async function loadThreadsAndChats() {
    setLoading(true);
    setOffset(0);
    setHasMore(true);
    try {
      const thr = await A.workspaceThreads(slug);
      const list = Array.isArray(thr?.threads) ? thr.threads : [];
      setThreads(list);
      const tslug = (list[0]?.slug ? String(list[0].slug) : undefined);
      setThreadSlug(tslug);
      if (tslug) {
        const data = await A.threadChats(slug, tslug, MESSAGES_PER_PAGE, 0);
        const raw = Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []);
        let items = sortOldestFirst(raw);
        setHasMore(items.length >= MESSAGES_PER_PAGE);
        setOffset(items.length);
        
        // Append persisted generation cards from backend
        try {
          const persisted = await A.genCardsByWorkspace(slug).catch(()=>({ cards: [] }));
          const cards: ExternalCard[] = Array.isArray((persisted as any)?.cards) ? (persisted as any).cards : [];
          if (cards.length) {
            const have = new Set(items.filter((m:any)=>m && m.card).map((m:any)=>String(m.card.id)));
            const mapped = cards.filter((c:any)=>!have.has(String(c.id))).map((c:any)=>({ role: (c.side || 'user'), content: '', sentAt: Number(c.timestamp||0)||Date.now(), card: { ...c } }));
            items = [...items, ...mapped];
            items = sortMessagesByTimestamp(items);
          }
        } catch {}
        setHistory(items);
      } else {
        // Fetch only user-interactive chats (not system metadata/generation operations)
        const data = await A.workspaceChats(slug, MESSAGES_PER_PAGE, 'desc', 'user-interactive', 0);
        const raw = Array.isArray(data?.history) ? data.history : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
        let items = sortOldestFirst(raw);
        setHasMore(items.length >= MESSAGES_PER_PAGE);
        setOffset(items.length);
        
        try {
          const persisted = await A.genCardsByWorkspace(slug).catch(()=>({ cards: [] }));
          const cards: ExternalCard[] = Array.isArray((persisted as any)?.cards) ? (persisted as any).cards : [];
          if (cards.length) {
            const have = new Set(items.filter((m:any)=>m && m.card).map((m:any)=>String(m.card.id)));
            const mapped = cards.filter((c:any)=>!have.has(String(c.id))).map((c:any)=>({ role: (c.side || 'user'), content: '', sentAt: Number(c.timestamp||0)||Date.now(), card: { ...c } }));
            items = [...items, ...mapped];
            items = sortMessagesByTimestamp(items);
          }
        } catch {}
        setHistory(items);
      }
    } catch {
      setHistory([]);
    } finally { setLoading(false); }
  }

  async function loadMoreMessages() {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      if (threadSlug) {
        const data = await A.threadChats(slug, threadSlug, MESSAGES_PER_PAGE, offset);
        const raw = Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []);
        const items = sortOldestFirst(raw);
        
        if (items.length < MESSAGES_PER_PAGE) {
          setHasMore(false);
        }
        
        if (items.length > 0) {
          setHistory(prev => {
            const combined = [...items, ...prev];
            return sortMessagesByTimestamp(combined);
          });
          setOffset(prev => prev + items.length);
        }
      } else {
        const data = await A.workspaceChats(slug, MESSAGES_PER_PAGE, 'desc', 'user-interactive', offset);
        const raw = Array.isArray(data?.history) ? data.history : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
        const items = sortOldestFirst(raw);
        
        if (items.length < MESSAGES_PER_PAGE) {
          setHasMore(false);
        }
        
        if (items.length > 0) {
          setHistory(prev => {
            const combined = [...items, ...prev];
            return sortMessagesByTimestamp(combined);
          });
          setOffset(prev => prev + items.length);
        }
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      setLoadingMore(false);
    }
  }

  React.useEffect(() => { loadThreadsAndChats(); }, [slug]);
  
  // Enhanced auto-scroll with smooth animations - triggers on history changes
  React.useEffect(() => { 
    if (atBottom && history.length > 0) {
      // Immediate scroll for streaming (no delay)
      requestAnimationFrame(() => scrollToBottom(true));
    }
  }, [history, atBottom, scrollToBottom]);
  // Inject external cards as synthetic assistant messages
  React.useEffect(() => {
    if (!externalCards || !externalCards.length) return;
    const map = injectedRef.current || {};
    setHistory((prev) => {
      let next = prev.slice();
      for (const c of externalCards) {
        const key = String(c.id);
        const ts = Number(c.timestamp || 0) || Date.now();
        const idx = next.findIndex((m: any) => !!m && m.card && String(m.card.id) === key);
        if (idx >= 0) {
          const old = next[idx] as any;
          next[idx] = { ...old, sentAt: ts, role: (c.side || 'user'), card: { ...(old.card || {}), ...c } };
        } else {
          next.push({ role: (c.side || 'user'), content: '', sentAt: ts, card: { ...c } });
        }
        map[key] = ts;
      }
      injectedRef.current = map;
      // Sort all messages and cards by timestamp after injection
      return sortMessagesByTimestamp(next);
    });
  }, [externalCards]);
  // Poll jobs and keep only those for this workspace
  // Pause polling during user typing to improve input responsiveness
  React.useEffect(() => {
    let cancelled = false;
    async function loadJobsOnce() {
      // Skip polling if user is actively typing
      if (isUserActive) return;
      
      try {
        const r = await apiFetch('/api/generate/jobs');
        const j = await r.json().catch(()=>({}));
        const list: Job[] = Array.isArray(j?.jobs) ? j.jobs : [];
        const filtered = list.filter((x) => String(x?.usedWorkspace || '') === String(slug));
        filtered.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        if (!cancelled) setWsJobs(filtered);
      } catch { if (!cancelled) setWsJobs([]); }
    }
    loadJobsOnce();
    const t = setInterval(loadJobsOnce, 5000);
    return () => { cancelled = true; clearInterval(t) };
  }, [slug, isUserActive]);

  // NOTE: Filter detection functions kept as safety net but not actively used
  // Messages are filtered server-side via apiSessionId='user-interactive' parameter

  // Generate stable keys for messages to optimize React rendering
  const getMessageKey = React.useCallback((m: any, idx: number): string => {
    // Try to use message ID if available
    if (m?.id) return `msg-${m.id}`;
    if (m?.uuid) return `msg-${m.uuid}`;
    
    // For cards, use card ID
    if (m?.card?.id) return `card-${m.card.id}`;
    
    // Fallback: create a stable hash from message content + timestamp
    const content = String(m?.content || m?.message || m?.text || '');
    const timestamp = m?.sentAt ?? m?.createdAt ?? m?.created_at ?? m?.timestamp ?? m?.date ?? 0;
    const role = m?.role || 'unknown';
    
    // Create a simple hash from content + timestamp + role
    const hashStr = `${role}-${timestamp}-${content.substring(0, 50)}`;
    return `msg-${idx}-${hashStr.split('').reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0)}`;
  }, []);

  const looksLikeCode = React.useCallback((txt: string) => {
    const s = String(txt || '');
    if (!s) return false;
    if (/```/.test(s)) return true;
    const lines = s.split(/\r?\n/);
    const codeKeywords = /(\bfunction\b|\bclass\b|\binterface\b|\bconst\b|\blet\b|\bexport\b|\bimport\b|<\/?[a-z][^>]*>)/i;
    const punctScore = (s.match(/[{};<>]/g) || []).length;
    const keywordHits = lines.reduce((acc, l) => acc + (codeKeywords.test(l) ? 1 : 0), 0);
    return lines.length >= 6 && (keywordHits >= 3 || punctScore >= 6);
  }, []);

  // Copy message handler
  const handleCopyMessage = React.useCallback((message: any) => {
    const content = String(message.content || message.message || message.text || '');
    
    navigator.clipboard.writeText(content).then(() => {
      toast.success('Response copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
  }, []);

  // Export message handler
  const handleExportMessage = React.useCallback((message: any) => {
    const content = String(message.content || message.message || message.text || '');
    const timestamp = message.sentAt ?? message.createdAt ?? message.created_at ?? message.timestamp ?? message.date;
    const sailpointMeta = (message as any).sailpointMetadata;
    
    // Create filename with timestamp
    const date = timestamp ? new Date(timestamp) : new Date();
    const dateStr = date.toISOString().replace(/[:.]/g, '-').split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    const filename = `ai-response-${dateStr}-${timeStr}.md`;
    
    // Build export content
    let exportContent = '# AI Response Export\n\n';
    
    // Add metadata
    exportContent += `**Date:** ${date.toLocaleString()}\n\n`;
    if (customerName) {
      exportContent += `**Customer:** ${customerName}\n\n`;
    }
    if (sailpointMeta) {
      exportContent += `**SailPoint Query Execution**\n\n`;
      if (sailpointMeta.stepsExecuted) {
        exportContent += `- Steps Executed: ${sailpointMeta.stepsExecuted}\n`;
      }
      if (sailpointMeta.totalItemsFetched) {
        exportContent += `- Total Items Fetched: ${sailpointMeta.totalItemsFetched}\n`;
      }
      exportContent += '\n';
    }
    
    exportContent += '---\n\n';
    exportContent += content;
    
    // Create blob and download
    const blob = new Blob([exportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast.success('Response exported successfully');
  }, [customerName]);

  // Export single message to Word
  const handleExportMessageToWord = React.useCallback(async (message: any) => {
    if (!slug) {
      toast.error('No workspace selected');
      return;
    }

    try {
      const messageId = message.id ?? message._id ?? message.uuid;
      if (!messageId) {
        toast.error('Message ID not found');
        return;
      }

      // Call the export API for a single message
      const response = await fetch(`/api/anythingllm/workspace/${slug}/export-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 'user-interactive',
          messageIds: [messageId],
          includeMetadata: false, // No SailPoint metadata for individual exports
        }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const timestamp = message.sentAt ?? message.createdAt ?? new Date();
      const date = new Date(timestamp);
      const dateStr = date.toISOString().replace(/[:.]/g, '-').split('T')[0];
      const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `ai-response-${dateStr}-${timeStr}.docx`;
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Response exported to Word');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export response to Word');
    }
  }, [slug]);

  // Export entire conversation handler
  const handleExportConversation = React.useCallback(() => {
    if (history.length === 0) {
      toast.error('No messages to export');
      return;
    }

    // Build export content
    let exportContent = '# Chat Conversation Export\n\n';
    
    const date = new Date();
    exportContent += `**Workspace:** ${slug}\n`;
    exportContent += `**Export Date:** ${date.toLocaleString()}\n`;
    if (customerName) {
      exportContent += `**Customer:** ${customerName}\n`;
    }
    exportContent += `**Messages:** ${history.length}\n\n`;
    exportContent += '---\n\n';

    // Export all messages
    history.forEach((message, index) => {
      const role = message.role === 'user' ? '👤 **User**' : '🤖 **Assistant**';
      const timestamp = message.sentAt ? new Date(message.sentAt).toLocaleString() : '';
      
      exportContent += `## ${role}`;
      if (timestamp) {
        exportContent += ` - ${timestamp}`;
      }
      exportContent += '\n\n';
      
      // Add SailPoint metadata if available
      if (message.sailpointContext) {
        try {
          const sailpointMeta = JSON.parse(message.sailpointContext);
          if (sailpointMeta.stepsExecuted || sailpointMeta.totalItemsFetched) {
            exportContent += `*SailPoint Query: ${sailpointMeta.stepsExecuted || 0} steps, ${sailpointMeta.totalItemsFetched || 0} items*\n\n`;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      
      exportContent += message.content + '\n\n';
      
      if (index < history.length - 1) {
        exportContent += '---\n\n';
      }
    });

    // Create blob and download
    const blob = new Blob([exportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `chat-conversation-${slug}-${date.toISOString().split('T')[0]}.md`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${history.length} messages to Markdown`);
  }, [history, slug, customerName]);

  // Export chat to Word document
  const handleExportToWord = React.useCallback(async () => {
    if (history.length === 0) {
      toast.error('No messages to export');
      return;
    }

    setExporting(true);
    try {
      const messageIds = history.map((msg: any) => msg.id).filter(Boolean);
      
      const response = await apiFetch(`/api/anythingllm/workspace/${slug}/export-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 'user-interactive',
          messageIds: messageIds.length > 0 ? messageIds : undefined,
          includeMetadata: true
        })
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filename = `chat-export-${slug}-${new Date().toISOString().split('T')[0]}.docx`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Exported ${history.length} messages to Word`);
    } catch (error) {
      console.error('Failed to export to Word:', error);
      toast.error('Failed to export chat to Word');
    } finally {
      setExporting(false);
    }
  }, [history, slug]);

  const latestRelevantJob = React.useCallback(() => wsJobs[0], [wsJobs]);

  // PERFORMANCE: Memoize the displayed messages to prevent unnecessary re-computations
  const displayedMessages = React.useMemo(() => {
    return history.slice(-MAX_MESSAGES_IN_VIEW);
  }, [history, MAX_MESSAGES_IN_VIEW]);

  // PERFORMANCE: Extract message list into memoized component to prevent re-renders during typing
  const MessageList = React.memo(({ 
    messages, 
    latestRelevantJob, 
    onOpenLogs, 
    markdownComponents,
    getMessageKey,
    onCopyMessage,
    onExportMessage,
    onExportMessageToWord
  }: {
    messages: any[];
    latestRelevantJob: () => Job | undefined;
    onOpenLogs?: (jobId: string) => void;
    markdownComponents: any;
    getMessageKey: (m: any, idx: number) => string;
    onCopyMessage: (message: any) => void;
    onExportMessage: (message: any) => void;
    onExportMessageToWord: (message: any) => void;
  }) => {
    return (
      <>
        {messages.map((m, idx) => (
          <ChatMessage 
            key={getMessageKey(m, idx)}
            message={m}
            index={idx}
            latestRelevantJob={latestRelevantJob}
            onOpenLogs={onOpenLogs}
            markdownComponents={markdownComponents}
            onCopyMessage={onCopyMessage}
            onExportMessage={onExportMessage}
            onExportMessageToWord={onExportMessageToWord}
          />
        ))}
      </>
    );
  });

  // Memoize ReactMarkdown components to avoid recreating on every render
  // Memoize individual chat message to prevent unnecessary re-renders
  // PERFORMANCE: Removed inline filter checks - messages are pre-filtered before rendering
  const ChatMessage = React.memo(({ 
    message, 
    index, 
    latestRelevantJob,
    onOpenLogs,
    markdownComponents,
    onCopyMessage,
    onExportMessage,
    onExportMessageToWord
  }: { 
    message: any; 
    index: number; 
    latestRelevantJob: () => Job | undefined;
    onOpenLogs?: (jobId: string) => void;
    markdownComponents: any;
    onCopyMessage: (message: any) => void;
    onExportMessage: (message: any) => void;
    onExportMessageToWord: (message: any) => void;
  }) => {
    const m = message;
    const isUser = (String(m.role || '')).toLowerCase() === 'user';
    const fullText = String(m.content || m.message || m.text || '');
    const card = (m as any).card as ExternalCard | undefined;
    const timestamp = m.sentAt ?? m.createdAt ?? m.created_at ?? m.timestamp ?? m.date;
    const timeAgo = formatTimeAgo(timestamp);
    const isSailPoint = !!(m as any).sailpointMetadata;
    
    // Extract planning/progress steps from content (lines starting with [ANALYSIS], [PLAN], [STEP], etc.)
    const progressPrefixes = ['[ANALYSIS]', '[PLAN]', '[STEP]', '[COMPLETE]', '[SUCCESS]', '[AGGREGATE]', '[SYNTHESIS]', '[ERROR]', '[WARNING]'];
    const lines = fullText.split('\n');
    const progressLines: string[] = [];
    const contentLines: string[] = [];
    
    for (const line of lines) {
      const hasProgressPrefix = progressPrefixes.some(prefix => line.trim().startsWith(prefix));
      if (hasProgressPrefix) {
        progressLines.push(line);
      } else {
        contentLines.push(line);
      }
    }
    
    const hasProgress = progressLines.length > 0 && isSailPoint;
    const mainContent = contentLines.join('\n').trim();
    const [showProgress, setShowProgress] = React.useState(false);
    
    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className="group flex flex-col gap-1 max-w-[75%]">
          {/* SailPoint query progress (collapsible, like ChatGPT thinking) */}
          {hasProgress && !isUser && (
            <div className="bg-muted/50 border border-border/50 rounded-lg overflow-hidden text-xs">
              <button
                onClick={() => setShowProgress(!showProgress)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-muted/70 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                    <line x1="12" y1="22.08" x2="12" y2="12"/>
                  </svg>
                  <span className="text-blue-600 dark:text-blue-400 font-medium">SailPoint Query Execution</span>
                  {(m as any).sailpointMetadata?.stepsExecuted && (
                    <span className="text-muted-foreground">
                      · {(m as any).sailpointMetadata.stepsExecuted} step{(m as any).sailpointMetadata.stepsExecuted > 1 ? 's' : ''}
                      {(m as any).sailpointMetadata?.totalItemsFetched > 0 && ` · ${(m as any).sailpointMetadata.totalItemsFetched} items`}
                    </span>
                  )}
                </div>
                <svg 
                  className={`h-4 w-4 text-muted-foreground transition-transform ${showProgress ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {showProgress && (
                <div className="px-3 py-2 border-t border-border/50 space-y-1 text-muted-foreground max-h-64 overflow-y-auto font-mono">
                  {progressLines.map((line, idx) => {
                    // Strip the [PREFIX] tag and format nicely
                    const cleaned = line.replace(/^\[([A-Z]+)\]\s*/, (match, prefix) => {
                      const icons: Record<string, string> = {
                        'ANALYSIS': '⚡',
                        'PLAN': '📋',
                        'STEP': '⏳',
                        'COMPLETE': '✓',
                        'SUCCESS': '✓',
                        'AGGREGATE': '📊',
                        'SYNTHESIS': '💭',
                        'ERROR': '✗',
                        'WARNING': '⚠'
                      };
                      const icon = icons[prefix] || '•';
                      return `${icon} `;
                    });
                    return (
                      <div key={idx} className="text-xs leading-relaxed">{cleaned}</div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className={`relative whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 ${isUser ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-card border rounded-bl-md'}`}>
            {/* Copy and Export buttons for assistant messages */}
            {!isUser && !card && (
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => onCopyMessage(m)}
                      aria-label="Copy response"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy response</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => onExportMessage(m)}
                      aria-label="Export response (Markdown)"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export to Markdown</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => onExportMessageToWord(m)}
                      aria-label="Export response to Word"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export to Word</TooltipContent>
                </Tooltip>
              </div>
            )}
            {card ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="font-medium flex-1">
                    {isUser
                      ? 'Document Requested'
                      : (card.jobStatus === 'running' 
                          ? 'Document Generating' 
                          : card.jobStatus === 'done' 
                            ? 'Document Generated'
                            : card.jobStatus === 'error'
                              ? 'Generation Failed'
                              : 'Document Generation'
                        )}
                  </div>
                  {/* Status Badge */}
                  {card.jobStatus === 'running' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1 shrink-0">
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      Running
                    </span>
                  )}
                  {card.jobStatus === 'done' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 flex items-center gap-1 shrink-0">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      Done
                    </span>
                  )}
                  {card.jobStatus === 'error' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 flex items-center gap-1 shrink-0">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>
                      Error
                    </span>
                  )}
                  {card.jobStatus === 'cancelled' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20 shrink-0">
                      Cancelled
                    </span>
                  )}
                </div>
                <div className="text-sm opacity-90">
                  {card.template ? (<div>Template: {card.template}</div>) : null}
                  {!isUser && card.filename ? (<div>File: {card.filename}</div>) : null}
                </div>
                {isUser && card.aiContext ? (
                  <div className="text-xs opacity-75">AI Context: {card.aiContext}</div>
                ) : null}
                <div className="flex items-center gap-2 pt-1">
                  {card.jobId ? (
                    isUser ? (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button asChild size="icon" variant="ghost" aria-label="View job details">
                              <a href={`#jobs?id=${encodeURIComponent(card.jobId)}`}>
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View job details & logs</TooltipContent>
                        </Tooltip>
                        {onOpenLogs ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button size="icon" variant="ghost" aria-label="View generation progress" onClick={(e)=>{ e.preventDefault(); onOpenLogs?.(card.jobId!) }}>
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View generation progress</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button asChild size="icon" variant="ghost" aria-label="Download">
                              <a href={`/api/generate/jobs/${encodeURIComponent(card.jobId)}/file?download=true`}>
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Download</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label="Open folder" onClick={async (e)=>{ e.preventDefault(); try { await apiFetch(`/api/generate/jobs/${encodeURIComponent(card.jobId || '')}/reveal`) } catch {} }}>
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h5l2 3h9a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Open folder</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button asChild size="icon" variant="ghost" aria-label="View job">
                              <a href={`#jobs?id=${encodeURIComponent(card.jobId)}`}>
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View job</TooltipContent>
                        </Tooltip>
                      </>
                    )
                  ) : (
                    <a className="underline" href="#jobs">View jobs</a>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-sm [&>*]:my-0 [&>ul]:mt-1 [&>ol]:mt-1 [&>h1]:mt-2 [&>h2]:mt-2 [&>h3]:mt-1.5" style={{ lineHeight: '1.6' }}>
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {mainContent || fullText}
                </ReactMarkdown>
              </div>
            )}
          </div>
          {timeAgo && (
            <div className={`text-xs text-muted-foreground px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'text-right' : 'text-left'}`}>
              {timeAgo}
            </div>
          )}
        </div>
      </div>
    );
  }, (prevProps, nextProps) => {
    // Custom comparison function for React.memo to prevent unnecessary re-renders
    // Only re-render if the message content, role, or timestamp changes
    const prevMsg = prevProps.message;
    const nextMsg = nextProps.message;
    
    // Compare message identity
    if (prevMsg?.id !== nextMsg?.id) return false;
    if (prevMsg?.uuid !== nextMsg?.uuid) return false;
    
    // Compare message content
    const prevContent = String(prevMsg?.content || prevMsg?.message || prevMsg?.text || '');
    const nextContent = String(nextMsg?.content || nextMsg?.message || nextMsg?.text || '');
    if (prevContent !== nextContent) return false;
    
    // Compare role
    if (prevMsg?.role !== nextMsg?.role) return false;
    
    // Compare timestamp
    const prevTime = prevMsg?.sentAt ?? prevMsg?.createdAt ?? prevMsg?.created_at ?? prevMsg?.timestamp ?? 0;
    const nextTime = nextMsg?.sentAt ?? nextMsg?.createdAt ?? nextMsg?.created_at ?? nextMsg?.timestamp ?? 0;
    if (prevTime !== nextTime) return false;
    
    // Compare card status (for generation cards)
    if (prevMsg?.card?.jobStatus !== nextMsg?.card?.jobStatus) return false;
    
    // Compare SailPoint metadata
    if (prevMsg?.sailpointMetadata?.stepsExecuted !== nextMsg?.sailpointMetadata?.stepsExecuted) return false;
    
    // All relevant props are the same, skip re-render
    return true;
  });

  // Separate CodeBlock component to avoid useState inside useMemo
  const CodeBlock = React.memo(({ children, className, ...props }: any) => {
    const [copied, setCopied] = React.useState(false);
    const codeString = String(children).replace(/\n$/, '');
    const isInline = !className;
    
    const handleCopy = async () => {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    
    return isInline ? (
      <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
        {children}
      </code>
    ) : (
      <div className="relative group my-3">
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 p-1.5 rounded bg-background hover:bg-muted border border-border opacity-0 group-hover:opacity-100 transition-opacity z-10"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <pre className="bg-muted border border-border rounded p-3 overflow-x-auto">
          <code className="text-xs font-mono text-foreground" {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  });

  const markdownComponents = React.useMemo(() => ({
    // Headings - minimal top spacing
    h1: ({node, children, ...props}: any) => (
      <h1 className="font-semibold text-base" {...props}>{children}</h1>
    ),
    h2: ({node, children, ...props}: any) => (
      <h2 className="font-semibold text-sm" {...props}>{children}</h2>
    ),
    h3: ({node, children, ...props}: any) => (
      <h3 className="font-medium text-sm" {...props}>{children}</h3>
    ),
    // Paragraphs - no margin
    p: ({node, children, ...props}: any) => {
      const isEmpty = !children || (typeof children === 'string' && !children.trim());
      if (isEmpty) return null;
      return <p {...props}>{children}</p>;
    },
    // Lists - tight spacing
    ul: ({node, children, ...props}: any) => (
      <ul className="list-disc pl-5" {...props}>{children}</ul>
    ),
    ol: ({node, children, ...props}: any) => (
      <ol className="list-decimal pl-5" {...props}>{children}</ol>
    ),
    // List items - unwrap paragraphs and filter empty
    li: ({node, children, ...props}: any) => {
      const filtered = React.Children.toArray(children).filter((child: any) => {
        if (typeof child === 'string') {
          return child.trim().length > 0;
        }
        if (child?.type === 'p') {
          const text = child.props?.children;
          if (typeof text === 'string') {
            return text.trim().length > 0;
          }
        }
        return true;
      });
      
      if (filtered.length === 0) {
        return null;
      }
      
      const unwrapped = React.Children.map(filtered, (child: any) => {
        if (child?.type === 'p') {
          return child.props.children;
        }
        return child;
      });
      
      return <li {...props}>{unwrapped}</li>;
    },
    // Strong/Bold
    strong: ({node, children, ...props}: any) => (
      <strong className="font-semibold" {...props}>{children}</strong>
    ),
    // Tables - with max height for performance
    table: ({node, children, ...props}: any) => (
      <div className="my-3 overflow-auto max-h-96 border border-border rounded">
        <table className="w-full text-xs" {...props}>{children}</table>
      </div>
    ),
    thead: ({node, children, ...props}: any) => (
      <thead className="bg-muted sticky top-0" {...props}>{children}</thead>
    ),
    tbody: ({node, children, ...props}: any) => (
      <tbody {...props}>{children}</tbody>
    ),
    tr: ({node, children, ...props}: any) => (
      <tr className="border-b border-border" {...props}>{children}</tr>
    ),
    th: ({node, children, ...props}: any) => (
      <th className="px-3 py-2 text-left font-semibold" {...props}>{children}</th>
    ),
    td: ({node, children, ...props}: any) => (
      <td className="px-3 py-2" {...props}>{children}</td>
    ),
    // Code - use extracted CodeBlock component
    code: CodeBlock,
  }), []);

  function sortOldestFirst(arr: any[]): any[] {
    if (!Array.isArray(arr) || arr.length <= 1) return arr || [];
    const toMs = (m: any) => {
      const v = m?.createdAt ?? m?.created_at ?? m?.sentAt ?? m?.timestamp ?? m?.date;
      const n = v ? new Date(v).getTime() : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    const withT = arr.map((m, i) => ({ m, i, t: toMs(m) }));
    const hasAny = withT.some(x => typeof x.t === 'number');
    if (!hasAny) return arr.slice();
    const a = withT[0].t ?? withT[0].i;
    const b = withT[withT.length - 1].t ?? withT[withT.length - 1].i;
    const isDesc = typeof a === 'number' && typeof b === 'number' ? (a > b) : false;
    if (isDesc) return arr.slice().reverse();
    return arr.slice();
  }

  // Sort messages and cards by timestamp (oldest first)
  function sortMessagesByTimestamp(messages: any[]) {
    return messages.slice().sort((a, b) => {
      const getTime = (m: any) => {
        const v = m?.sentAt ?? m?.createdAt ?? m?.created_at ?? m?.timestamp ?? m?.date;
        return v ? new Date(v).getTime() : 0;
      };
      return getTime(a) - getTime(b);
    });
  }

  async function send() {
    const inputEl = messageInputRef.current;
    if (!inputEl) return;
    
    const t = inputEl.value.trim();
    if (!t) return;
    
    // Prevent multiple simultaneous streams
    if (activeStreamRef.current) {
      console.warn('[WorkspaceChat] Stream already active, ignoring send request');
      return;
    }
    
    inputEl.value = ""; // Clear the input
    
    // Check if this is a SailPoint query (starts with @sailpoint)
    const isSailPointQuery = t.toLowerCase().startsWith('@sailpoint');
    const actualMessage = isSailPointQuery ? t.substring(10).trim() : t; // Remove @sailpoint prefix
    
    // Add user message immediately
    setHistory((h) => [
      ...h, 
      { role: 'user', content: t, sentAt: Date.now() }
    ]);
    
    // Build request body
    const body = { 
      message: actualMessage, 
      mode: 'chat', 
      sessionId: 'user-interactive',
      // Only enable SailPoint orchestration if @sailpoint is present
      useSailPoint: isSailPointQuery,
      customerId: isSailPointQuery ? customerId : undefined,
      customerName: isSailPointQuery ? customerName : undefined
    } as any;
    
    const effectiveThread = threadSlug || (threads && threads[0]?.slug ? String(threads[0].slug) : undefined);
    if (!threadSlug && effectiveThread) setThreadSlug(effectiveThread);

    // Try streaming first (works for both thread and workspace)
    if (stream) {
      activeStreamRef.current = true; // Mark stream as active
      try {
        const resp = effectiveThread 
          ? await A.streamThread(slug, effectiveThread, body)
          : await A.streamWorkspace(slug, body);
        
        // Store response in ref to prevent garbage collection
        activeResponseRef.current = resp;
        
        if (!resp.ok || !resp.body) {
          activeResponseRef.current = null;
          throw new Error(String(resp.status));
        }
        
        // Initialize assistant message when stream starts
        let assistantMessageAdded = false;
        let acc = "";
        
        // Start reading immediately to keep connection alive
        await readSSEStream(resp, (payload) => {
          if (!assistantMessageAdded) {
            setHistory((h) => [...h, { role: 'assistant', content: '', sentAt: Date.now() }]);
            assistantMessageAdded = true;
          }
          
          let shouldUpdate = false;
          try {
            const j = JSON.parse(payload);
            const piece = j?.textResponse ?? j?.text ?? j?.delta ?? j?.content ?? '';
            const pieceStr = String(piece);
            
            // Skip empty status messages (keepalives)
            if (!pieceStr) return;
            
            // Check if this is a progress/status message
            const progressPrefixes = [
              '[ANALYSIS]', '[PLAN]', '[STEP]', '[COMPLETE]', '[SUCCESS]', 
              '[AGGREGATE]', '[SYNTHESIS]', '[ERROR]', '[WARNING]',
              '[REFINING', '[ITERATION', '[INFO]', '[STOPPING]', '[NOTE]',
              '[EXPANSION]', '[DISCOVERING]', // Reference expansion and schema discovery
              '🔄', '💭', '🔍', '✓'  // Emoji indicators
            ];
            const isProgressMessage = progressPrefixes.some(prefix => pieceStr.trim().startsWith(prefix));
            
            if (isProgressMessage) {
              // Extract just the progress text, clean it up
              // Remove prefixes like [STEP], [REFINING X], emojis, etc.
              let cleaned = pieceStr
                .replace(/^\[([A-Z]+)\s*\d*\/?\d*\]\s*/g, '') // Remove [WORD X/Y] or [WORD]
                .replace(/^[🔄💭🔍✓]\s*/g, '') // Remove leading emojis
                .trim();
              
              setStreamingProgress(cleaned);
              // Don't accumulate progress in the message content
            } else {
              // Regular content - accumulate it
              acc += pieceStr;
              setStreamingProgress(''); // Clear progress when actual content starts
              shouldUpdate = true;
            }
          } catch { 
            acc += payload;
            shouldUpdate = true;
          }
          
          if (shouldUpdate) {
            setHistory((h) => {
              const base = h.slice();
              const last = base[base.length - 1];
              if (last && last.role === 'assistant') {
                last.content = acc;
              } else {
                base.push({ role: 'assistant', content: acc, sentAt: Date.now() });
              }
              return base;
            });
          }
          
          // Debounced scroll to bottom as content streams in (only if user is at bottom)
          scheduleAutoScroll();
        });
        setStreamingProgress(''); // Clear progress when done
        activeStreamRef.current = false; // Stream complete
        activeResponseRef.current = null; // Clear response reference
        
        // Reload messages from backend to get proper IDs for export functionality
        try {
          const data = await A.workspaceChats(slug, 10, 'desc', 'user-interactive', 0);
          const raw = Array.isArray(data?.history) ? data.history : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
          if (raw.length > 0) {
            // Update history with messages that have proper database IDs
            setHistory((prev) => {
              const updated = sortOldestFirst(raw);
              // Keep any cards or other items that might not be in the database
              const cards = prev.filter(m => m.card);
              return sortMessagesByTimestamp([...updated, ...cards]);
            });
          }
        } catch (reloadErr) {
          console.error('[WorkspaceChat] Failed to reload messages after chat:', reloadErr);
          // Don't fail the chat if reload fails
        }
      } catch (err) {
        console.error('[WorkspaceChat] Streaming error:', err);
        activeStreamRef.current = false; // Clear active flag on error
        activeResponseRef.current = null; // Clear response reference
        // Update last assistant message with error
        setHistory((h) => {
          const base = h.slice();
          const last = base[base.length - 1];
          if (last && last.role === 'assistant' && !last.content) {
            last.content = 'Sorry, there was an error processing your message. Please try again.';
          }
          return base;
        });
      }
      return;
    }

    // Non-streaming fallback (shouldn't normally be used)
    try {
      const r = effectiveThread ? await A.chatThread(slug, effectiveThread, body) : await A.chatWorkspace(slug, body);
      const text = r?.textResponse || r?.response || JSON.stringify(r);
      setHistory((h) => [...h, { role: 'assistant', content: text, sentAt: Date.now() }]);
    } catch {
    } finally { setReplying(false) }
  }

async function exportHistory() {
  if (exporting) return;
  setExporting(true);
  try {
    const effectiveThread = threadSlug || (threads[0]?.slug ? String(threads[0].slug) : undefined);
    const fetchLimit = 500;

    let base: any[] = [];
    if (effectiveThread) {
      const data = await A.threadChats(slug, effectiveThread);
      base = Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []);
    } else {
      const data = await A.workspaceChats(slug, fetchLimit, "asc");
      base = Array.isArray(data?.history)
        ? data.history
        : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
    }

    let merged = sortOldestFirst(base);

    try {
      const persisted = await A.genCardsByWorkspace(slug).catch(() => ({ cards: [] }));
      const cards: ExternalCard[] = Array.isArray((persisted as any)?.cards) ? (persisted as any).cards : [];
      if (cards.length) {
        const have = new Set(merged.filter((m: any) => m && m.card).map((m: any) => String(m.card.id)));
        const mapped = cards
          .filter((c: any) => !have.has(String(c.id)))
          .map((c: any) => ({
            role: c.side || "user",
            content: "",
            sentAt: Number(c.timestamp || 0) || Date.now(),
            card: { ...c },
          }));
        if (mapped.length) merged = [...merged, ...mapped];
      }
    } catch (err) {
      console.error("Failed to merge persisted cards for export", err);
    }

    if (externalCards && externalCards.length) {
      const have = new Set(merged.filter((m: any) => m && m.card).map((m: any) => String(m.card.id)));
      for (const c of externalCards) {
        const key = String(c.id);
        if (have.has(key)) continue;
        merged.push({
          role: c.side || "user",
          content: "",
          sentAt: Number(c.timestamp || 0) || Date.now(),
          card: { ...c },
        });
        have.add(key);
      }
    }

    merged = sortOldestFirst(merged);

    const safeClone = (value: any) => JSON.parse(JSON.stringify(value ?? null));
    const toIso = (value: any) => {
      if (value == null) return null;
      const n = typeof value === "number" ? value : Date.parse(String(value));
      if (!Number.isFinite(n)) return null;
      return new Date(n).toISOString();
    };

    const exportMessages = merged.map((message, index) => {
      const cloned = safeClone(message);
      const baseTimestamp =
        cloned?.sentAt ?? cloned?.createdAt ?? cloned?.created_at ?? cloned?.timestamp ?? cloned?.date ?? null;
      const textValue = cloned?.content ?? cloned?.message ?? cloned?.text ?? "";
      return {
        index,
        role: cloned?.role != null ? String(cloned.role) : null,
        text: typeof textValue === "string" ? textValue : String(textValue ?? ""),
        timestamp: toIso(baseTimestamp),
        timestampRaw: baseTimestamp ?? null,
        card: cloned?.card ?? undefined,
        sources: cloned?.sources ?? cloned?.documents ?? cloned?.context ?? undefined,
        raw: cloned,
      };
    });

    const metadata: Record<string, any> = {
      workspaceSlug: slug,
      threadSlug: effectiveThread ?? null,
      exportedAt: new Date().toISOString(),
      messageCount: exportMessages.length,
      includesExternalCards: Boolean(externalCards && externalCards.length),
      messages: exportMessages,
    };

    if (threads.length) {
      metadata.threads = threads.map((t) => ({
        slug: t?.slug != null ? String(t.slug) : null,
        name: t?.name != null ? String(t.name) : null,
      }));
    }

    const sanitizeSegment = (value?: string) => {
      if (!value) return null;
      const cleaned = value.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      return cleaned ? cleaned.toLowerCase() : null;
    };

    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const stamp = `${datePart}-${timePart}`;

    const segments = ["docsmith", "chat"];
    const safeWorkspace = sanitizeSegment(slug) ?? "workspace";
    segments.push(safeWorkspace);
    const safeThread = sanitizeSegment(effectiveThread);
    if (safeThread) segments.push(safeThread);
    const filenameBase = `${segments.join("-")}-${stamp}`;

    // Create user-friendly markdown export
    let markdownContent = '# Chat Conversation Export\n\n';
    
    markdownContent += `**Workspace:** ${slug}\n`;
    if (effectiveThread) {
      const threadName = threads.find(t => String(t.slug) === effectiveThread)?.name;
      markdownContent += `**Thread:** ${threadName || effectiveThread}\n`;
    }
    if (customerName) {
      markdownContent += `**Customer:** ${customerName}\n`;
    }
    markdownContent += `**Export Date:** ${new Date().toLocaleString()}\n`;
    markdownContent += `**Messages:** ${exportMessages.length}\n\n`;
    markdownContent += '---\n\n';

    // Export all messages
    exportMessages.forEach((msg, index) => {
      const role = msg.role === 'user' ? '👤 **User**' : '🤖 **Assistant**';
      const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
      
      markdownContent += `## ${role}`;
      if (timestamp) {
        markdownContent += ` - ${timestamp}`;
      }
      markdownContent += '\n\n';
      
      // Add sources/context if available
      if (msg.sources) {
        markdownContent += `*Sources/Context: ${JSON.stringify(msg.sources)}*\n\n`;
      }
      
      // Add card info if available
      if (msg.card) {
        markdownContent += `*Card: ${msg.card.title || 'Untitled'}*\n\n`;
      }
      
      markdownContent += msg.text + '\n\n';
      
      if (index < exportMessages.length - 1) {
        markdownContent += '---\n\n';
      }
    });

    if (typeof window === "undefined" || typeof document === "undefined") {
      throw new Error("Export is only supported in a browser environment");
    }

    // Create markdown file
    const blob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filenameBase}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    const successMessage = exportMessages.length
      ? `Exported ${exportMessages.length} chat message${exportMessages.length === 1 ? "" : "s"}`
      : "Chat history exported (no messages yet)";
    toast.success(successMessage);
  } catch (error) {
    console.error("Failed to export chat history", error);
    toast.error("Failed to export chat history");
  } finally {
    setExporting(false);
  }
}

return (
    <Card className={("h-full min-h-0 p-0 flex flex-col " + (className || '')).trim()}>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b">
        <strong>{title}</strong>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Export chat history"
                disabled={exporting || loading}
                onClick={(e) => {
                  e.preventDefault();
                  void exportHistory();
                }}
              >
                {exporting ? (
                  <Icon.Refresh className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon.Download className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export chat (Markdown)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Export to Word document"
                disabled={exporting || loading}
                onClick={(e) => {
                  e.preventDefault();
                  void handleExportToWord();
                }}
              >
                {exporting ? (
                  <Icon.Refresh className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export to Word</TooltipContent>
          </Tooltip>
          {headerActions}
        </div>

      </div>
      <div className="relative flex-1 min-h-0 flex">
        <div className="text-sm text-muted-foreground sr-only">{loading ? 'Loading chats.' : `${history.length} message${history.length === 1 ? '' : 's'}`}</div>
        <div ref={listRef} onScroll={onListScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-0 space-y-2">
            {hasMore && !loading && (
              <div className="flex justify-center py-2">
                {loadingMore ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse"></span>
                    <span>Loading older messages...</span>
                  </div>
                ) : (
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={loadMoreMessages}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Load older messages
                  </Button>
                )}
              </div>
            )}
            {/* PERFORMANCE: Render only MAX_MESSAGES_IN_VIEW most recent messages (memoized) */}
            <MessageList 
              messages={displayedMessages}
              latestRelevantJob={latestRelevantJob}
              onOpenLogs={onOpenLogs}
              markdownComponents={markdownComponents}
              getMessageKey={getMessageKey}
              onCopyMessage={handleCopyMessage}
              onExportMessage={handleExportMessage}
              onExportMessageToWord={handleExportMessageToWord}
            />
            {/* Show streaming progress above the bubble */}
            {streamingProgress && (
              <div className="flex justify-start">
                <div className="max-w-[75%] px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-2 animate-in fade-in duration-200">
                  <svg className="h-3.5 w-3.5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  <span>{streamingProgress}</span>
                </div>
              </div>
            )}
            {replying && (
              <div className="flex justify-start">
                <div className="max-w-[75%] rounded-2xl px-3.5 py-2.5 bg-card border rounded-bl-md">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce"></span>
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0.15s]"></span>
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0.3s]"></span>
                  </div>
                </div>
              </div>
            )}
        </div>
        {!atBottom && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="secondary" className="absolute right-4 bottom-4 rounded-full shadow" onClick={() => scrollToBottom(true)}>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Scroll to bottom</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="px-2.5 border-t h-24 flex items-center">
        <div className="relative w-full">
          <Textarea
            ref={messageInputRef}
            placeholder={customerId ? "Type a message (use @sailpoint for SailPoint queries)..." : "Type a message"}
            defaultValue=""
            onChange={() => signalActivity()}
            onKeyDown={(e) => { if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); send(); } }}
            className="flex-1 w-full pr-12 resize-none h-14 max-h-40"
          />
          {onOpenGenerate ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Generate document"
                  className="absolute right-14 top-1/2 -translate-y-1/2 rounded-full h-10 w-10"
                  onClick={() => onOpenGenerate?.()}>
                  <Icon.DocSparkles className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Generate</TooltipContent>
            </Tooltip>
          ) : null}
          <Button
            onClick={send}
            disabled={replying}
            size="icon"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full h-10 w-10"
            aria-label="Send"
          >
            <Icon.Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}





