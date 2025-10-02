import * as React from "react";
import CustomersPage from "./pages/Customers";
import WorkspacesPage from "./pages/Workspaces";
import JobsPage from "./pages/Jobs";
import WorkspaceDetailPage from "./pages/WorkspaceDetail";
import TemplatesPage from "./pages/Templates";
import SettingsPage from "./pages/Settings";
import HelpPage from "./pages/Help";
import Setup from "./components/Setup";
import { Separator } from "./components/ui/separator";
import { Icon } from "./components/icons";
import { MetadataProvider } from "./contexts/MetadataContext";

function useHashRoute() {
  const [hash, setHash] = React.useState<string>(() => location.hash || "#customers");
  React.useEffect(() => { const on = () => setHash(location.hash || "#customers"); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return hash.toLowerCase();
}

export default function App() {
  const hash = useHashRoute();
  const [setupCompleted, setSetupCompleted] = React.useState<boolean>(() => {
    return localStorage.getItem('docsmith-setup-completed') === 'true';
  });
  
  const [isMaximized, setIsMaximized] = React.useState<boolean>(false);

  // Notify Electron main process about setup status on app load
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI && setupCompleted) {
      // If setup is already completed, show the menu bar immediately
      window.electronAPI.setupCompleted().catch(console.error);
    }
  }, [setupCompleted]);

  // Track window state for Electron
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.getWindowState) {
      // Get initial window state
      window.electronAPI.getWindowState().then((state: { isMaximized: boolean }) => {
        setIsMaximized(state.isMaximized);
      }).catch(console.error);

      // Listen for window state changes if available
      if (window.electronAPI.onWindowStateChanged) {
        const cleanup = window.electronAPI.onWindowStateChanged((state: { isMaximized: boolean }) => {
          setIsMaximized(state.isMaximized);
        });

        return cleanup;
      }
    }
  }, []);

  // If setup is not completed, show the setup wizard
  if (!setupCompleted) {
    return <Setup onComplete={() => setSetupCompleted(true)} />;
  }

  let content: React.ReactNode = null;
  if (hash.startsWith('#workspaces/')) {
    const parts = hash.replace(/^#/, '').split('/');
    const slug = decodeURIComponent(parts[1] || '');
    content = <WorkspaceDetailPage slug={slug} />;
  } else if (hash === '#workspaces') content = <WorkspacesPage />;
  else if (hash.startsWith('#jobs')) content = <JobsPage />;
  else if (hash === '#templates') content = <TemplatesPage />;
  else if (hash === '#settings') content = <SettingsPage />;
  else if (hash === '#help') content = <HelpPage />;
  else content = <CustomersPage />;

  const linkCls = (active: boolean) =>
    "sidebar-link " + (active ? "is-active" : "");

  const isElectron = typeof window !== 'undefined' && window.electronAPI;

  return (
    <MetadataProvider>
      <div className="h-screen bg-background flex flex-col">
      {/* Custom title bar for Electron - Fixed at top */}
      {isElectron && (
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center h-8 bg-background border-b border-border/50 drag-region">
          <div className="flex items-center px-4 text-sm text-muted-foreground">
            DocSmith
          </div>
          <div className="flex items-center space-x-1 pr-2 no-drag">
            <button
              onClick={() => window.electronAPI?.minimizeApp()}
              className="w-6 h-6 flex items-center justify-center hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Minimize"
            >
              <Icon.Minimize className="w-3 h-3" />
            </button>
            <button
              onClick={() => window.electronAPI?.maximizeApp()}
              className="w-6 h-6 flex items-center justify-center hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Icon.Restore className="w-3 h-3" />
              ) : (
                <Icon.Maximize className="w-3 h-3" />
              )}
            </button>
            <button
              onClick={() => window.electronAPI?.closeApp()}
              className="w-6 h-6 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground rounded text-muted-foreground transition-colors"
              title="Close"
            >
              <Icon.X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
      
      <div className={`flex h-full bg-background ${isElectron ? 'pt-8' : ''}`}>
        {/* Fixed Sidebar */}
        <aside className="fixed left-0 top-0 z-40 w-[260px] h-full app-sidebar border-r bg-background overflow-hidden flex flex-col" style={{ paddingTop: isElectron ? '2rem' : '0' }}>
          {/* Brand/Logo Area */}
          <div className="p-6 border-b border-border/50 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground overflow-hidden">
                <img src="./docsmith-icon.png" alt="DocSmith Icon" className="h-7 w-7 object-contain" />
              </div>
              <div>
                <div className="text-lg font-semibold tracking-tight">DocSmith</div>
                <div className="text-xs text-muted-foreground">Document Management</div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="p-4 space-y-1 flex-1 overflow-hidden">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Main
            </div>
            <a className={linkCls(hash==="#customers") + " group"}
               href="#customers">
              <Icon.Users className="h-4 w-4" />
              <span>Customers</span>
            </a>
            <a className={linkCls(hash.startsWith("#workspaces")) + " group"}
               href="#workspaces">
              <Icon.Bot className="h-4 w-4" />
              <span>Workspaces</span>
            </a>
            <a className={linkCls(hash==="#templates") + " group"}
               href="#templates">
              <Icon.FileText className="h-4 w-4" />
              <span>Templates</span>
            </a>
            
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mt-4">
              Resources
            </div>
            <a className={linkCls(hash.startsWith("#jobs")) + " group"}
               href="#jobs">
              <Icon.Clock className="h-4 w-4" />
              <span>Jobs</span>
            </a>
            <a className={linkCls(hash==="#settings") + " group"}
               href="#settings">
              <Icon.Settings className="h-4 w-4" />
              <span>Settings</span>
            </a>
            <a className={linkCls(hash==="#help") + " group"}
               href="#help">
              <Icon.HelpCircle className="h-4 w-4" />
              <span>Help</span>
            </a>
          </nav>
          {/* Sidebar Footer */}
          <footer className="h-16 flex items-center justify-center text-xs text-muted-foreground border-t border-border/50 gap-2">
            <span>v1.0.0</span>
            <a
              href="https://github.com/perrychapman/DocSmith"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              title="GitHub"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="inline-block align-text-bottom"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
              GitHub
            </a>
          </footer>
        </aside>
        
        {/* Main Content - with left margin to account for fixed sidebar */}
        <main className={`flex-1 ml-[260px] ${hash === '#settings' ? 'p-6 overflow-y-auto' : 'p-6 overflow-hidden flex flex-col h-full'}`}>
          <div className={`mx-auto w-full max-w-[95vw] xl:max-w-[90vw] 2xl:max-w-[85vw] ${hash === '#settings' ? 'space-y-6 pb-32' : 'flex-1 flex flex-col min-h-0'}`}>
            {content}
          </div>
        </main>
      </div>
      </div>
    </MetadataProvider>
  );
}
