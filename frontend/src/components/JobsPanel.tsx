import * as React from "react";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "./ui/button";
import { Icon } from "./icons";
import { toast } from "sonner";

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

export function JobsPanel({ customerId, className, autoRefreshMs = 5000 }: { customerId?: number | null; className?: string; autoRefreshMs?: number }) {
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [active, setActive] = React.useState<Job | null>(null);

  const formatDuration = (ms?: number) => {
    if (!ms || !isFinite(ms) || ms < 0) return ''
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${String(s).padStart(2,'0')}`
  }

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
    if (s === 'running') return (<Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-warning text-warning bg-warning/10"><Icon.Refresh className="h-3.5 w-3.5 animate-spin" /></Badge>)
    if (s === 'done') return (<Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-success text-success bg-success/10"><Icon.Check className="h-3.5 w-3.5" /></Badge>)
    if (s === 'cancelled') return (<Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-muted-foreground text-muted-foreground bg-muted/10"><Icon.Stop className="h-3.5 w-3.5" /></Badge>)
    return (<Badge variant="outline" aria-label={label} title={label} className="shrink-0 h-6 w-6 p-0 grid place-items-center border-destructive text-destructive bg-destructive/10"><Icon.X className="h-3.5 w-3.5" /></Badge>)
  }

  async function loadJobs() {
    try {
      setLoading(true);
      const r = await fetch('/api/generate/jobs');
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json().catch(()=>({}));
      const list: Job[] = Array.isArray(j?.jobs) ? j.jobs : [];
      setJobs(list);
      const filtered = customerId ? list.filter(x=> x.customerId === customerId) : list
      if (!activeId && filtered.length) setActiveId(filtered[0].id)
    } catch {
    } finally {
      setLoading(false);
    }
  }

  async function openJob(id: string) {
    setActiveId(id);
    try {
      const r = await fetch(`/api/generate/jobs/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json().catch(()=>({}));
      setActive(j as Job);
    } catch {
      setActive(null);
    }
  }

  React.useEffect(() => { loadJobs(); }, [customerId]);
  React.useEffect(() => {
    const t = setInterval(() => {
      loadJobs();
      if (activeId) openJob(activeId);
    }, Math.max(1000, autoRefreshMs));
    return () => clearInterval(t);
  }, [activeId, autoRefreshMs]);
  React.useEffect(() => { if (activeId) openJob(activeId); }, [activeId, jobs.length]);

  const cancelActive = async () => { if (!activeId) return; try { await fetch(`/api/generate/jobs/${encodeURIComponent(activeId)}/cancel`, { method: 'POST' }); await openJob(activeId) } catch {} };
  async function revealTemplateFolder(slug: string) {
    try {
      const r = await fetch(`/api/templates/${encodeURIComponent(slug)}/open-folder`, { method: 'POST' });
      const j = await r.json().catch(() => (null as any));
      if (!r.ok) throw new Error(String(j?.error || r.status));
      toast.success('Opened template folder');
    } catch (e:any) {
      toast.error(e?.message ? String(e.message) : 'Failed to open template folder');
    }
  }

  const filtered = (customerId ? jobs.filter(j => j.customerId === customerId) : jobs);

  return (
    <div className={"grid grid-cols-12 gap-2 h-full min-h-0 " + (className||'')}>
      {/* Left: list */}
      <div className="col-span-12 md:col-span-4 h-full min-h-0 flex flex-col">
        <div className="panel-3d p-2 min-h-0 flex-1 overflow-hidden flex flex-col">
          <ScrollArea className="flex-1 min-h-0">
            <ul className="text-sm space-y-1 pr-2">
              {filtered.map(j => (
                <li key={j.id} className={"flex items-center gap-2 justify-between rounded px-2 py-1 cursor-pointer " + (activeId===j.id?"bg-accent":"hover:bg-accent/40")} onClick={()=>openJob(j.id)}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-2">
                      <span className="truncate">{j.template}</span>
                    </div>
                    <div className="text-xs text-foreground truncate">{!isCompileJob(j) ? `for ${String(j.customerName || j.customerId)} • ` : ''}{new Date(j.updatedAt).toLocaleString()}</div>
                  </div>
                  {statusBadgeIcon(j.status)}
                </li>
              ))}
              {!filtered.length ? <li className="text-muted-foreground">No jobs.</li> : null}
            </ul>
          </ScrollArea>
        </div>
      </div>

      {/* Right: details */}
      <div className="col-span-12 md:col-span-8 h-full min-h-0 flex flex-col">
        <div className="panel-3d p-3 min-h-0 flex-1 overflow-hidden">
          {!active ? (
            <div className="text-muted-foreground text-sm">Select a job to view details.</div>
          ) : (
            <div className="flex flex-col h-full space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="font-medium">
                      {isCompileJob(active)
                        ? `${active.template}`
                        : `${active.template} for ${String(active.customerName || active.customerId)}`}
                    </div>
                    <Badge variant={isCompileJob(active)?'secondary':'outline'}>{isCompileJob(active)?'Template Compile':'Document Generation'}</Badge>
                    {statusBadge(active.status)}
                  </div>
                  <div className="text-xs text-muted-foreground">Updated {new Date(active.updatedAt).toLocaleString()}</div>
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
                        <a href="#" onClick={async (e)=>{ e.preventDefault(); try { await fetch(`/api/generate/jobs/${encodeURIComponent(active.id)}/reveal`) } catch {} }}>
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
                Started {new Date(active.startedAt).toLocaleString()} • Completed {active.completedAt ? new Date(active.completedAt).toLocaleString() : '-'} • Elapsed {formatDuration(((active.completedAt ? new Date(active.completedAt) : new Date()).getTime()) - new Date(active.startedAt).getTime())}
              </div>

              {Array.isArray(active.steps) && active.steps.length ? (
                <div className="max-h-56 min-h-[6rem] flex flex-col min-h-0">
                  <div className="font-medium mb-1">Steps</div>
                  <ScrollArea className="h-full min-h-0">
                    <ul className="space-y-1 pr-2 pb-2">
                      {active.steps.map((s, idx) => (
                        <li key={idx} className="flex items-center justify-between border rounded px-2 py-1">
                          <div>
                            <div className="text-sm">{s.name}</div>
                            <div className="text-xs text-muted-foreground">{s.status || '-'} {s.durationMs ? `• ${formatDuration(s.durationMs)}` : ''}</div>
                          </div>
                          <div className="text-xs text-muted-foreground">{s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : ''} {s.endedAt?`→ ${new Date(s.endedAt).toLocaleTimeString()}`:''}</div>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </div>
              ) : null}

              <div className="flex-1 min-h-0 flex flex-col w-full">
                <div className="font-medium mb-1">Logs</div>
                <div className="border rounded bg-muted/30 p-2 flex-1 min-h-0">
                  <ScrollArea className="flex-1 min-h-0">
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

export default JobsPanel;

