import * as React from "react";
import { Separator } from "../components/ui/separator";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../components/ui/alert-dialog";

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
  // Auto-refresh is always on; no UI toggle
  const [error, setError] = React.useState<string | null>(null);
  const [clearOpen, setClearOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  async function loadJobs() {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch('/api/generate/jobs');
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json().catch(()=>({}));
      const list: Job[] = Array.isArray(j?.jobs) ? j.jobs : [];
      setJobs(list);
      if (!activeId && list.length) setActiveId(list[0].id);
    } catch (e:any) {
      setError(String(e?.message || e));
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

  React.useEffect(() => { loadJobs(); }, []);
  // Periodically refresh both list and the active job details
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

  const cancelActive = async () => { if (!activeId) return; try { await fetch(`/api/generate/jobs/${encodeURIComponent(activeId)}/cancel`, { method: 'POST' }); await openJob(activeId) } catch {} };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div>
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
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Generation Jobs</h1>
        <div className="text-xs text-muted-foreground">Auto-refreshing every 5s</div>
      </div>
      <Separator />
      {error ? (<div className="text-sm text-red-600">Failed to load jobs: {error}</div>) : null}

      <Card className="p-4">
        <div className="grid grid-cols-12 gap-4 h-[55vh]">
          <div className="col-span-12 md:col-span-5 flex flex-col min-h-0 h-full">
          <div className="flex items-center gap-2 mb-2">
            <Select value={(statusFilter || 'all')} onValueChange={(v)=>setStatusFilter(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Search template or customer" value={q} onChange={(e)=>setQ(e.target.value)} />
            <Button variant="outline" className="ml-auto" onClick={()=> setClearOpen(true)}>Clear All</Button>
          </div>
          <div className="border rounded-md p-2 min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <ul className="text-sm space-y-1 pr-2">
                {filtered.map(j => (
                  <li key={j.id} className={"flex items-center gap-2 justify-between rounded px-2 py-1 cursor-pointer " + (activeId===j.id?"bg-accent":"hover:bg-accent/40")} onClick={()=>openJob(j.id)}>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{j.template} · {j.customerName || j.customerId}</div>
                      <div className="text-xs text-muted-foreground truncate">{j.status} · {new Date(j.updatedAt).toLocaleString()}</div>
                    </div>
                    <span className={`text-xs ${j.status==='done'?'text-green-600':(j.status==='error'?'text-red-600':(j.status==='cancelled'?'text-gray-500':'text-amber-600'))}`}>{j.status}</span>
                  </li>
                ))}
                {!filtered.length ? <li className="text-muted-foreground">No jobs.</li> : null}
              </ul>
            </ScrollArea>
          </div>
        </div>

        <div className="col-span-12 md:col-span-7 min-h-0 flex flex-col h-full">
          <div className="border rounded-md p-3 min-h-0 flex-1 overflow-hidden">
            {!active ? (
              <div className="text-muted-foreground text-sm">Select a job to view details.</div>
            ) : (
              <div className="flex flex-col h-full space-y-3 pr-2 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">Job {active.id}</div>
                    <div className="text-xs text-muted-foreground">{active.status} · Updated {new Date(active.updatedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {active.status==='running' ? (
                      <a className="text-xs underline text-red-600" href="#" onClick={(e)=>{ e.preventDefault(); cancelActive(); }}>Cancel</a>
                    ) : null}
                    <a className="text-xs underline text-destructive" href="#" onClick={(e)=>{ e.preventDefault(); setDeleteOpen(true) }}>Delete</a>
                    {active.file ? (
                      <>
                        <a className="text-xs underline" href="#" onClick={async (e)=>{ e.preventDefault(); try { await fetch(`/api/generate/jobs/${encodeURIComponent(active.id)}/reveal`) } catch {} }} title={active.file.path}>Open Folder</a>
                        <a className="text-xs underline" href={`/api/generate/jobs/${encodeURIComponent(active.id)}/file?download=true`}>Download</a>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-muted-foreground">Customer</div>
                    <div>{active.customerName || active.customerId}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Template</div>
                    <div>{active.template}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">File</div>
                    <div className="truncate">{active.file?.name || '-'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Workspace</div>
                    <div>{active.usedWorkspace || '-'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Started</div>
                    <div>{new Date(active.startedAt).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Completed</div>
                    <div>{active.completedAt ? new Date(active.completedAt).toLocaleString() : '-'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Elapsed</div>
                    <div>{formatDuration(((active.completedAt ? new Date(active.completedAt) : new Date()).getTime()) - new Date(active.startedAt).getTime())}</div>
                  </div>
                </div>

                {Array.isArray(active.steps) && active.steps.length ? (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="font-medium mb-1">Steps</div>
                    <ScrollArea className="flex-1 min-h-0">
                      <ul className="space-y-1 pr-2">
                        {active.steps.map((s, idx) => (
                          <li key={idx} className="flex items-center justify-between border rounded px-2 py-1">
                            <div>
                              <div className="text-sm">{s.name}</div>
                              <div className="text-xs text-muted-foreground">{s.status || '-'} {s.durationMs ? `· ${formatDuration(s.durationMs)}` : ''}</div>
                            </div>
                            <div className="text-xs text-muted-foreground">{s.startedAt ? new Date(s.startedAt).toLocaleTimeString() : ''} {s.endedAt?`→ ${new Date(s.endedAt).toLocaleTimeString()}`:''}</div>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                ) : null}

                <div className="flex-1 min-h-0 flex flex-col">
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
      </Card>
      {/* Clear All Jobs */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all job records?</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="text-sm text-muted-foreground">This only deletes job history. Generated files are not removed.</div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async ()=>{ try { await fetch('/api/generate/jobs', { method: 'DELETE' }); setClearOpen(false); setActive(null); setActiveId(null); await loadJobs() } catch { setClearOpen(false) } }}>Clear</AlertDialogAction>
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
            <AlertDialogAction onClick={async ()=>{ try { if (active?.id) { await fetch(`/api/generate/jobs/${encodeURIComponent(active.id)}`, { method: 'DELETE' }) } setDeleteOpen(false); setActive(null); setActiveId(null); await loadJobs() } catch { setDeleteOpen(false) } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}




