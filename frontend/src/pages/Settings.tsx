import * as React from "react";
import { Card } from "../components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "../components/ui/input";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Separator } from "../components/ui/separator";
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

  const [apiUrl, setApiUrl] = React.useState<string>("http://localhost:3001");
  const [apiKey, setApiKey] = React.useState<string>("");
  const [lastChecked, setLastChecked] = React.useState<string>("");
  const [urlTouched, setUrlTouched] = React.useState(false);
  const [keyTouched, setKeyTouched] = React.useState(false);

  const urlValid = React.useMemo(() => {
    try {
      const u = (apiUrl || '').trim();
      if (!u) return false;
      const parsed = new URL(u);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false }
  }, [apiUrl]);
  const keyValid = React.useMemo(() => {
    const v = (apiKey || '').trim();
    return /^(?:[A-Za-z0-9]{7}-){3}[A-Za-z0-9]{7}$/.test(v);
  }, [apiKey]);
  const canTest = urlValid && keyValid;

  async function check() {
    setLoading(true);
    try {
      await fetch(`/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anythingLLMUrl: (apiUrl||'').trim() || undefined, anythingLLMKey: (apiKey||'').trim() || undefined }) });
    } catch {}
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
    (async () => {
      try {
        const s = await fetch(`/api/settings`).then((r) => r.json()).catch(() => ({}));
        if (s?.anythingLLMUrl) setApiUrl(String(s.anythingLLMUrl)); else setApiUrl('http://localhost:3001');
        if (s?.anythingLLMKey) setApiKey(String(s.anythingLLMKey));
      } catch {}
      await check();
    })();
  }, []);

  async function save() {
    try {
      setLoading(true);
      const r = await fetch(`/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anythingLLMUrl: (apiUrl||'').trim() || undefined, anythingLLMKey: (apiKey||'').trim() || undefined }) });
      if (!r.ok) throw new Error(String(r.status));
      toast.success("Settings saved");
    } catch { toast.error("Failed to save settings") }
    finally { setLoading(false) }
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

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">AnythingLLM Connectivity</div>
          <Button onClick={check} disabled={loading || !canTest}><Icon.Refresh className="h-4 w-4 mr-2"/>Test Connection</Button>
        </div>
        <div className="text-sm text-muted-foreground">
          Configure the AnythingLLM connection here. Default URL: http://localhost:3001. Create or manage an API key in the AnythingLLM docs: <a className="underline" href="https://docs.useanything.com/features/api" target="_blank" rel="noreferrer">API guide</a>.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="text-sm">API URL</div>
            <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} onBlur={() => setUrlTouched(true)} aria-invalid={!urlValid && urlTouched} placeholder="http://localhost:3001" />
            <div className="text-xs text-muted-foreground">Default: http://localhost:3001</div>
            {!urlValid && urlTouched ? <div className="text-xs text-red-600">Enter a valid http(s) URL</div> : null}
          </div>
          <div className="space-y-1">
            <div className="text-sm">API Key</div>
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} onBlur={() => setKeyTouched(true)} aria-invalid={!keyValid && keyTouched} placeholder="XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX" />
            <div className="text-xs text-muted-foreground">Stored server-side; used for AnythingLLM auth</div>
            {!keyValid && keyTouched ? <div className="text-xs text-red-600">Format: XXXXXXX-XXXXXXX-XXXXXXX-XXXXXXX</div> : null}
          </div>
        </div>
        <Separator />
        <div className="space-y-2">
          <div className="text-sm font-medium">Status</div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full ${ping === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>ping: {ping}</span>
            <span className={`text-xs px-2 py-1 rounded-full ${auth === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>auth: {auth}</span>
          </div>
          {lastChecked ? <div className="text-xs text-muted-foreground">Last checked: {lastChecked}</div> : null}
        </div>
      </Card>
    </div>
  );
}

