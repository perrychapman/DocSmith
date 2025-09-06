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
        <div className="font-medium">AnythingLLM</div>
        <div className="text-sm">Ping: <span className={ping === 'ok' ? 'text-green-600' : 'text-muted-foreground'}>{ping}</span></div>
        <div className="text-sm">Auth: <span className={auth === 'ok' ? 'text-green-600' : 'text-muted-foreground'}>{auth}</span></div>
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
        <div>
          <Button onClick={save} disabled={saving}><Icon.Refresh className="h-4 w-4 mr-2"/>Save</Button>
        </div>
      </Card>
    </div>
  );
}
