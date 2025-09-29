import * as React from "react";
import { Separator } from "../components/ui/separator";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";
import { Icon } from "../components/icons";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";

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
  logs?: string[];
  file?: { path: string; name: string };
  error?: string;
  steps?: Array<{ name: string; status?: 'start'|'ok'|'error'; startedAt?: string; endedAt?: string; durationMs?: number }>;
};

export default function JobsPage() {
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<Job | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>('');
  const [q, setQ] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [clearOpen, setClearOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const idFromHash = React.useCallback((): string | null => {
    const h = location.hash || '';
    if (!h.toLowerCase().startsWith('#jobs')) return null;
    const q = h.split('?')[1] || '';
    const sp = new URLSearchParams(q);
    const id = sp.get('id');
    return id || null;
  }, []);

  async function loadJobs() {
    try {
      setLoading(true);
      setError(null);
      const r = await apiFetch('/api/generate/jobs');
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json().catch(()=>({}));
      const list: Job[] = Array.isArray(j?.jobs) ? j.jobs : [];
      setJobs(list);
      if (list.length) {
        const desired = idFromHash();
        if (!activeId) {
          const pick = desired && list.find(x=> x.id === desired) ? desired : list[0].id;
          setActiveId(pick);
        } else if (desired && activeId !== desired && list.find(x=> x.id === desired)) {
          setActiveId(desired);
        }
      }
    } catch (e:any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function openJob(id: string) {
    setActiveId(id);
    try {
      const r = await apiFetch(`/api/generate/jobs/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json().catch(()=>({}));
      setActive(j as Job);
    } catch {
      setActive(null);
    }
  }

  React.useEffect(() => { loadJobs(); }, []);
  // Pick up job id from hash like #jobs?id=<id>
  React.useEffect(() => {
    const parse = () => {
      const id = idFromHash();
      if (id) setActiveId(id);
    };
    parse();
    const on = () => parse();
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  React.useEffect(() => {
    const t = setInterval(() => {
      loadJobs();
      if (activeId) openJob(activeId);
    }, 5000);
    return () => clearInterval(t);
  }, [activeId]);
  React.useEffect(() => { if (activeId) openJob(activeId); }, [activeId, jobs.length]);

  const formatDuration = (ms?: number) => {
    if (!ms || !isFinite(ms) || ms < 0) return ''
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${String(s).padStart(2,'0')}`
  }

  const filtered = jobs.filter(j =>
    (!statusFilter || j.status === statusFilter) &&
    (!q || (j.template?.toLowerCase().includes(q.toLowerCase()) || String(j.customerName||j.customerId).toLowerCase().includes(q.toLowerCase())))
  );

  const isCompileJob = (j: Job) => {
    return j.customerId === 0 || String(j.customerName||'').toLowerCase() === 'template' || String(j.file?.name||'') === 'generator.full.ts'
  }
  const statusLabel = (s: Job['status']) => (s === 'done' ? 'Completed' : (s.charAt(0).toUpperCase() + s.slice(1)))
  const statusBadge = (s: Job['status']) => {
    const label = statusLabel(s)
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

  const statusBadgeIcon = (s: Job['status']) => {
    const label = statusLabel(s)
    if (s === 'running') {
      return (
        <Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-warning text-warning bg-warning/10">
          <Icon.Refresh className="h-3.5 w-3.5 animate-spin" />
        </Badge>
      )
    }
    if (s === 'done') {
      return (
        <Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-success text-success bg-success/10">
          <Icon.Check className="h-3.5 w-3.5" />
        </Badge>
      )
    }
    if (s === 'cancelled') {
      return (
        <Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-muted-foreground text-muted-foreground bg-muted/10">
          <Icon.Stop className="h-3.5 w-3.5" />
        </Badge>
      )
    }
    return (
      <Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-destructive text-destructive bg-destructive/10">
        <Icon.X className="h-3.5 w-3.5" />
      </Badge>
    )
  }

  const cancelActive = async () => { if (!activeId) return; try { await apiFetch(`/api/generate/jobs/${encodeURIComponent(activeId)}/cancel`, { method: 'POST' }); await openJob(activeId) } catch {} };

  async function revealTemplateFolder(slug: string) {
    try {
      const r = await apiFetch(`/api/templates/${encodeURIComponent(slug)}/open-folder`, { method: 'POST' });
      const j = await r.json().catch(() => (null as any));
      if (!r.ok) throw new Error(String(j?.error || r.status));
      toast.success('Opened template folder');
    } catch (e:any) {
      toast.error(e?.message ? String(e.message) : 'Failed to open template folder');
    }
  }

  return (
    <div className="flex flex-col space-y-6 animate-in fade-in-0 slide-in-from-top-2 h-full">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="#workspaces">DocSmith</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Jobs</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon.Clock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Generation Jobs</h1>
              <p className="text-muted-foreground">Monitor document generation tasks</p>
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">Auto-refreshing every 5s</div>
      </div>
      {error ? (<div className="text-sm text-red-600">Failed to load jobs: {error}</div>) : null}

      <div className="grid grid-cols-12 gap-2 flex-1 min-h-0 lg:min-h-[calc(100vh-200px)]">
        {/* Left: Jobs list */}
        <div className="col-span-12 md:col-span-4 flex min-h-0">
          <Card className="flex h-full w-full flex-col overflow-hidden border-0 shadow-lg">
            <div className="p-4 border-b border-border/40 bg-muted/20">
              <div className="flex items-center gap-3 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input 
                    placeholder="Search template or customer" 
                    value={q} 
                    onChange={(e)=>setQ(e.target.value)} 
                    className="pl-9 h-9 bg-background/50 border-border/50 focus:bg-background"
                  />
                </div>
                <Select value={(statusFilter || 'all')} onValueChange={(v)=>setStatusFilter(v === 'all' ? '' : v)}>
                  <SelectTrigger className="w-[170px] h-9">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="done">Completed</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="secondary" className="text-xs font-medium px-3 py-1 bg-primary/10 text-primary border-primary/20 shrink-0">
                  {filtered.length}
                </Badge>
              </div>
              <div>
                <Button variant="destructive" className="w-full h-9" onClick={()=> setClearOpen(true)}>Clear All</Button>
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4">
                <div className="space-y-2">
                  {filtered.map(j => (
                    <div 
                      key={j.id} 
                      className={
                        "group relative rounded-lg border p-3 transition-all duration-200 cursor-pointer hover:shadow-md " +
                        (activeId===j.id 
                          ? "bg-primary/10 border-primary/50 shadow-sm" 
                          : "hover:bg-accent/50 hover:border-accent")
                      } 
                      onClick={()=>openJob(j.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate text-sm flex items-center gap-2">
                            <span className="truncate">{j.template}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {!isCompileJob(j) ? `for ${String(j.customerName || j.customerId)} | ` : ''}{new Date(j.updatedAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="ml-2 flex items-center">
                          {statusBadgeIcon(j.status)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!filtered.length ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No jobs found.
                    </div>
                  ) : null}
                </div>
              </div>
            </ScrollArea>
          </Card>
        </div>

        {/* Right: Job details */}
        <div className="col-span-12 md:col-span-8 flex min-h-0">
          <Card className="flex h-full w-full flex-col overflow-hidden border-0 shadow-lg">
            {!active ? (
              <div className="p-8 text-center h-full flex items-center justify-center">
                <div className="space-y-3">
                  <div className="h-12 w-12 rounded-lg bg-muted/50 flex items-center justify-center mx-auto">
                    <Icon.Clock className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="text-sm text-muted-foreground">Select a job to view details</div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="p-4 border-b border-border/40 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-medium text-sm">{active.template}</div>
                        <div className="text-xs text-muted-foreground">
                          {!isCompileJob(active) ? `Customer: ${String(active.customerName || active.customerId)}` : 'Template compilation'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadgeIcon(active.status)}
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        onClick={() => setDeleteOpen(true)}
                        className="h-8"
                      >
                        <Icon.Trash className="h-3.5 w-3.5 mr-1.5" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-1 min-h-0 flex-col gap-4 p-4 text-sm overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">
                        {isCompileJob(active)
                          ? `${active.template}`
                          : `${active.template} for ${String(active.customerName || active.customerId)}`}
                      </div>
                      <Badge variant={isCompileJob(active)?'secondary':'outline'}>{isCompileJob(active)?'Template Compile':'Document Generation'}</Badge>
                      {statusBadge(active.status)}
                    </div>
                    <div className="flex items-center gap-1">
                      {active.status==='running' ? (
                        <Button size="icon" variant="ghost" aria-label="Cancel" title="Cancel" onClick={(e)=>{ e.preventDefault(); cancelActive(); }}>
                          <Icon.Stop className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {!isCompileJob(active) && active.file ? (
                        <>
                          <Button asChild size="icon" variant="ghost" aria-label="Open Folder" title="Open Folder">
                            <a href="#" onClick={async (e)=>{ e.preventDefault(); try { await apiFetch(`/api/generate/jobs/${encodeURIComponent(active.id)}/reveal`) } catch {} }}>
                              <Icon.Folder className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button asChild size="icon" variant="ghost" aria-label="Download" title="Download">
                            <a href={`/api/generate/jobs/${encodeURIComponent(active.id)}/file?download=true`}>
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
                            </a>
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Meta chips */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge asChild variant="outline">
                      <a href="#" title="Reveal Template Folder" onClick={(e)=>{ e.preventDefault(); revealTemplateFolder(active.template) }}>
                        Template: {active.template}
                      </a>
                    </Badge>
                    {!isCompileJob(active) ? (
                      <Badge asChild variant="outline"><a href="#customers" title="View Customers">Customer: {active.customerName || active.customerId}</a></Badge>
                    ) : null}
                    {active.file?.name ? (
                      <Badge asChild variant="outline">
                        <a href={`/api/generate/jobs/${encodeURIComponent(active.id)}/file?download=true`} title="Download file">File: {active.file.name}</a>
                      </Badge>
                    ) : (
                      <Badge variant="outline">File: -</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Started {new Date(active.startedAt).toLocaleString()} | Completed {active.completedAt ? new Date(active.completedAt).toLocaleString() : '-'} | Elapsed {formatDuration(((active.completedAt ? new Date(active.completedAt) : new Date()).getTime()) - new Date(active.startedAt).getTime())}
                  </div>

                  <div className="flex flex-1 min-h-0 flex-col gap-4">
                    {Array.isArray(active.steps) && active.steps.length ? (
                      <div className="flex min-h-[6rem] max-h-[45vh] flex-col overflow-hidden rounded border bg-muted/30">
                        <div className="flex items-center justify-between border-b border-border/40 bg-muted/20 px-3 py-2">
                          <div className="font-medium text-sm">Steps</div>
                          <div className="text-xs text-muted-foreground">
                            {active.steps.length} step{active.steps.length === 1 ? '' : 's'}
                          </div>
                        </div>
                        <ScrollArea className="flex-1 min-h-0">
                          <ul className="space-y-1 px-3 py-2">
                            {active.steps.map((s, idx) => (
                              <li key={idx} className="flex items-center justify-between border rounded px-2 py-1">
                                <div>
                                  <div className="text-sm">{s.name}</div>
                                  <div className="text-xs text-muted-foreground">{s.status || '-'} {s.durationMs ? `| ${formatDuration(s.durationMs)}` : ''}</div>
                                </div>
                                <div className="text-xs text-muted-foreground">{s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : ''} {s.endedAt?`-> ${new Date(s.endedAt).toLocaleTimeString()}`:''}</div>
                              </li>
                            ))}
                          </ul>
                        </ScrollArea>
                      </div>
                    ) : null}

                    <div className="flex flex-1 min-h-[8rem] flex-col overflow-hidden rounded border bg-muted/30">
                      <div className="border-b border-border/40 bg-muted/20 px-3 py-2">
                        <div className="font-medium text-sm">Logs</div>
                      </div>
                      <ScrollArea className="flex-1 min-h-0">
                        <pre className="whitespace-pre-wrap px-3 py-2 text-xs">{Array.isArray(active.logs) ? active.logs.join('\n') : ''}</pre>
                      </ScrollArea>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Clear All Jobs */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all job records?</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="text-sm text-muted-foreground">This only deletes job history. Generated files are not removed.</div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async ()=>{ try { await apiFetch('/api/generate/jobs', { method: 'DELETE' }); setClearOpen(false); setActive(null); setActiveId(null); await loadJobs() } catch { setClearOpen(false) } }}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete One Job */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job record?</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="text-sm text-muted-foreground">This only deletes the job record. The generated document remains on disk.</div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async ()=>{ try { if (active?.id) { await apiFetch(`/api/generate/jobs/${encodeURIComponent(active.id)}`, { method: 'DELETE' }) } setDeleteOpen(false); setActive(null); setActiveId(null); await loadJobs() } catch { setDeleteOpen(false) } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

