import * as React from "react";
import CustomersPage from "./pages/Customers";
import WorkspacesPage from "./pages/Workspaces";
import JobsPage from "./pages/Jobs";
import WorkspaceDetailPage from "./pages/WorkspaceDetail";
import TemplatesPage from "./pages/Templates";
import SettingsPage from "./pages/Settings";
import { Separator } from "./components/ui/separator";

function useHashRoute() {
  const [hash, setHash] = React.useState<string>(() => location.hash || "#customers");
  React.useEffect(() => { const on = () => setHash(location.hash || "#customers"); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return hash.toLowerCase();
}

export default function App() {
  const hash = useHashRoute();
  let content: React.ReactNode = null;
  if (hash.startsWith('#workspaces/')) {
    const parts = hash.replace(/^#/, '').split('/');
    const slug = decodeURIComponent(parts[1] || '');
    content = <WorkspaceDetailPage slug={slug} />;
  } else if (hash === '#workspaces') content = <WorkspacesPage />;
  else if (hash === '#jobs') content = <JobsPage />;
  else if (hash === '#templates') content = <TemplatesPage />;
  else if (hash === '#settings') content = <SettingsPage />;
  else content = <CustomersPage />;

  const linkCls = (active: boolean) =>
    "sidebar-link " + (active ? "is-active" : "");

  return (
    <div className="grid grid-cols-[240px_1fr] h-screen bg-background">
      <aside className="app-sidebar border-r p-4">
        <div className="text-lg font-semibold tracking-tight">DocSmith</div>
        <nav className="mt-4 flex flex-col gap-1">
          <a className={linkCls(hash==="#customers")}
             href="#customers">Customers</a>
          <a className={linkCls(hash.startsWith("#workspaces"))}
             href="#workspaces">Workspaces</a>
          <a className={linkCls(hash==="#jobs")}
             href="#jobs">Jobs</a>
          <a className={linkCls(hash==="#templates")}
             href="#templates">Templates</a>
          <a className={linkCls(hash==="#settings")}
             href="#settings">Settings</a>
        </nav>
      </aside>
      <main className="p-6 overflow-hidden">
        <div className="mx-auto w-full max-w-6xl space-y-6">
          {content}
        </div>
      </main>
    </div>
  );
}
