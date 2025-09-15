import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Icon } from "../components/icons";
import { toast } from "sonner";
import { useTheme } from "next-themes";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const [ping, setPing] = React.useState<string>("unknown");
  const [auth, setAuth] = React.useState<string>("unknown");
  const [loading, setLoading] = React.useState(false);
  const [wsList, setWsList] = React.useState<Array<{ name: string; slug: string }>>([]);
  const [compilerWs, setCompilerWs] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);
  const [lastChecked, setLastChecked] = React.useState<string>("");

  async function check() {
    setLoading(true);
    try {
      const pr = await fetch(`/api/anythingllm/ping`);
      setPing(pr.status === 200 ? "ok" : String(pr.status));
    } catch { setPing("error") }
    try {
      const ar = await fetch(`/api/anythingllm/auth`);
      setAuth(ar.status === 200 ? "ok" : (ar.status === 403 ? "invalid-key" : String(ar.status)));
    } catch { setAuth("error") }
    setLastChecked(new Date().toLocaleString());
    setLoading(false);
  }
  React.useEffect(() => {
    check();
    (async () => {
      try {
        const ws = await fetch(`/api/anythingllm/workspaces`).then((r) => r.json()).catch(() => ({}));
        const arr: Array<{ name: string; slug: string }> = Array.isArray(ws?.workspaces) ? ws.workspaces : (Array.isArray(ws) ? ws : []);
        setWsList(arr);
      } catch {}
      try {
        const s = await fetch(`/api/settings`).then((r) => r.json()).catch(() => ({}));
        if (s?.templateCompilerWorkspaceSlug) setCompilerWs(String(s.templateCompilerWorkspaceSlug));
      } catch {}
    })();
  }, []);

  async function save() {
    try {
      setSaving(true);
      const r = await fetch(`/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateCompilerWorkspaceSlug: compilerWs || undefined }) });
      if (!r.ok) throw new Error(String(r.status));
      toast.success("Settings saved");
    } catch { toast.error("Failed to save settings") }
    finally { setSaving(false) }
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
            <BreadcrumbPage>Settings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="text-2xl font-semibold tracking-tight">Configuration</h1>

      <Card className="p-4 space-y-3">
        <div className="font-medium">Appearance</div>
        <div className="text-sm text-muted-foreground">Choose your preferred theme. "System" follows your OS setting.</div>
        <div>
          <select
            className="w-full border rounded-md h-9 px-2 bg-background"
            value={mounted ? (theme ?? "system") : "system"}
            onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-medium">AnythingLLM Connectivity</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full ${ping === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>ping: {ping}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${auth === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>auth: {auth}</span>
        </div>
        {lastChecked ? <div className="text-xs text-muted-foreground">Last checked: {lastChecked}</div> : null}
        <div className="text-sm text-muted-foreground">
          Configure AnythingLLM in your environment (server-side): set <code>ANYTHINGLLM_API_URL</code> and <code>ANYTHINGLLM_API_KEY</code> in your <code>.env</code>. Optionally set <code>ANYTHINGLLM_INGEST_ROOT</code> when embedding local files.
        </div>
        <div>
          <Button variant="secondary" onClick={check} disabled={loading}><Icon.Refresh className="h-4 w-4 mr-2"/>Recheck</Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-medium">Template Compiler Workspace</div>
        <div className="text-sm text-muted-foreground">Choose which AnythingLLM workspace to use for compiling templates. If none is selected, a default "TemplateCompiler" workspace will be created automatically when needed.</div>
        <div>
          <select className="w-full border rounded-md h-9 px-2 bg-background" value={compilerWs} onChange={(e) => setCompilerWs(e.target.value)}>
            <option value="">(auto-create TemplateCompiler)</option>
            {wsList.map((w) => (
              <option key={w.slug} value={w.slug}>{w.name} ({w.slug})</option>
            ))}
          </select>
        </div>
        <div className="text-xs text-muted-foreground">{wsList.length} workspaces available. Manage workspaces under <a className="underline" href="#workspaces">Workspaces</a>.</div>
        <div>
          <Button onClick={save} disabled={saving}><Icon.Refresh className="h-4 w-4 mr-2"/>Save</Button>
        </div>
      </Card>
    </div>
  );
}
