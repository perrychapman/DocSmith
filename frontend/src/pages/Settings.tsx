import * as React from "react";
import { Card } from "../components/ui/card";
import { Button, buttonVariants } from "../components/ui/Button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Separator } from "../components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";
import { Icon } from "../components/icons";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { apiFetch } from "../lib/api";
import { cn } from "../lib/utils";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const [ping, setPing] = React.useState<string>("unknown");
  const [auth, setAuth] = React.useState<string>("unknown");
  const [loading, setLoading] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false);

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
      await apiFetch(`/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anythingLLMUrl: (apiUrl||'').trim() || undefined, anythingLLMKey: (apiKey||'').trim() || undefined }) });
    } catch {}
    try {
      const pr = await apiFetch(`/api/anythingllm/ping`);
      setPing(pr.status === 200 ? "ok" : String(pr.status));
    } catch { setPing("error") }
    try {
      const ar = await apiFetch(`/api/anythingllm/auth`);
      setAuth(ar.status === 200 ? "ok" : (ar.status === 403 ? "invalid-key" : String(ar.status)));
    } catch { setAuth("error") }
    setLastChecked(new Date().toLocaleString());
    setLoading(false);
  }

  React.useEffect(() => {
    (async () => {
      try {
        const s = await apiFetch(`/api/settings`).then((r) => r.json()).catch(() => ({}));
        if (s?.anythingLLMUrl) setApiUrl(String(s.anythingLLMUrl)); else setApiUrl('http://localhost:3001');
        if (s?.anythingLLMKey) setApiKey(String(s.anythingLLMKey));
      } catch {}
      await check();
    })();
  }, []);

  async function save() {
    try {
      setLoading(true);
      const r = await apiFetch(`/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anythingLLMUrl: (apiUrl||'').trim() || undefined, anythingLLMKey: (apiKey||'').trim() || undefined }) });
      if (!r.ok) throw new Error(String(r.status));
      toast.success("Settings saved");
    } catch { toast.error("Failed to save settings") }
    finally { setLoading(false) }
  }

  async function resetApp() {
    try {
      setResetting(true);
      setResetDialogOpen(false);
      const response = await apiFetch(`/api/reset/app`, { method: 'POST' });
      
      if (!response.ok) {
        throw new Error(`Reset failed with status ${response.status}`);
      }
      
      const result = await response.json();
      toast.success(result.message || "Application has been reset successfully");
      
      // Optionally refresh the page or redirect to setup
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('Reset failed:', error);
      toast.error("Failed to reset application: " + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setResetting(false);
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
            <BreadcrumbPage>Settings</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon.Settings className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
              <p className="text-muted-foreground">Configure application preferences and connections</p>
            </div>
          </div>
        </div>
      </div>

      <Card className="p-6 space-y-4">
        <div className="font-medium">Appearance</div>
        <div className="text-sm text-muted-foreground">Choose your preferred theme. "System" follows your OS setting.</div>
        <div>
          <Select 
            value={mounted ? (theme ?? "system") : "system"} 
            onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
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

      {/* Development Tools */}
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-medium">Development Tools</h3>
            <p className="text-sm text-muted-foreground">
              Tools for testing and debugging DocSmith
            </p>
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Reset Setup Wizard</div>
                <div className="text-xs text-muted-foreground">
                  Clear setup completion status to test the first-time setup experience
                </div>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  localStorage.removeItem('docsmith-setup-completed');
                  toast.success("Setup status cleared. Refresh the page to see the setup wizard.");
                }}
              >
                Reset Setup
              </Button>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-red-600">Reset All Data</div>
                <div className="text-xs text-muted-foreground">
                  Permanently delete all customers, templates, jobs, and documents
                </div>
              </div>
              <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    disabled={resetting}
                  >
                    {resetting ? (
                      <>
                        <Icon.Clock className="w-3 h-3 mr-1 animate-spin" />
                        Resetting...
                      </>
                    ) : (
                      <>
                        <Icon.Trash className="w-3 h-3 mr-1" />
                        Reset App
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
              </AlertDialog>
            </div>
          </div>
        </div>
      </Card>

      {/* Reset App Confirmation Dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset All Application Data?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete ALL data including:
              <ul className="mt-2 list-disc list-inside space-y-1">
                <li>All customers and their information</li>
                <li>All templates and documents</li>
                <li>All jobs and generation history</li>
                <li>All uploaded files</li>
              </ul>
              <strong className="text-red-600 mt-3 block">This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={resetApp} 
              className="!bg-destructive !text-destructive-foreground hover:!bg-destructive/90 focus:!ring-destructive"
            >
              Reset All Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

