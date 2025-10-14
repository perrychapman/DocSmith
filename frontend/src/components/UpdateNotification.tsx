import * as React from "react";
import { Icon } from "./icons";

interface UpdateInfo {
  version: string;
  releaseDate?: string;
}

interface DownloadProgress {
  percent: number;
  bytesPerSecond?: number;
  total?: number;
  transferred?: number;
}

export default function UpdateNotification() {
  const [updateState, setUpdateState] = React.useState<
    'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available'
  >('idle');
  const [updateInfo, setUpdateInfo] = React.useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = React.useState<number>(0);
  const [error, setError] = React.useState<string>("");
  const [currentVersion, setCurrentVersion] = React.useState<string>("");

  // Check if running in Electron with update support
  const isElectron = typeof window !== 'undefined' && 
                     window.electronAPI && 
                     typeof window.electronAPI.getAppVersion === 'function';

  React.useEffect(() => {
    if (!isElectron || !window.electronAPI) return;

    // Get current version
    window.electronAPI.getAppVersion().then(setCurrentVersion).catch(console.error);

    // Set up event listeners
    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info: UpdateInfo) => {
      setUpdateState('available');
      setUpdateInfo(info);
    });

    const cleanupNotAvailable = window.electronAPI.onUpdateNotAvailable(() => {
      setUpdateState('not-available');
      setTimeout(() => setUpdateState('idle'), 3000);
    });

    const cleanupDownloaded = window.electronAPI.onUpdateDownloaded((info: UpdateInfo) => {
      setUpdateState('downloaded');
      setUpdateInfo(info);
    });

    const cleanupProgress = window.electronAPI.onDownloadProgress((progress: DownloadProgress) => {
      setUpdateState('downloading');
      setDownloadProgress(Math.round(progress.percent));
    });

    const cleanupError = window.electronAPI.onUpdateError((err: any) => {
      setUpdateState('error');
      setError(err.message || 'Update failed');
    });

    return () => {
      cleanupAvailable();
      cleanupNotAvailable();
      cleanupDownloaded();
      cleanupProgress();
      cleanupError();
    };
  }, [isElectron]);

  const handleCheckForUpdates = async () => {
    if (!isElectron || !window.electronAPI) return;
    setUpdateState('checking');
    setError("");
    try {
      await window.electronAPI.checkForUpdates();
    } catch (err: any) {
      setUpdateState('error');
      setError(err.message || 'Failed to check for updates');
    }
  };

  const handleDownload = async () => {
    if (!isElectron || !window.electronAPI) return;
    setUpdateState('downloading');
    setDownloadProgress(0);
    try {
      await window.electronAPI.downloadUpdate();
    } catch (err: any) {
      setUpdateState('error');
      setError(err.message || 'Download failed');
    }
  };

  const handleInstall = async () => {
    if (!isElectron || !window.electronAPI) return;
    try {
      await window.electronAPI.installUpdate();
      // App will quit and install
    } catch (err: any) {
      setUpdateState('error');
      setError(err.message || 'Install failed');
    }
  };

  // Don't render anything if not in Electron
  if (!isElectron) return null;

  // Idle state - show version and check button
  if (updateState === 'idle') {
    return (
      <div className="flex items-center justify-between gap-2 px-2">
        <span className="text-xs text-muted-foreground">v{currentVersion}</span>
        <button
          onClick={handleCheckForUpdates}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          title="Check for updates"
        >
          <Icon.Refresh className="w-3 h-3" />
          <span className="hidden xl:inline">Check</span>
        </button>
      </div>
    );
  }

  // Checking state
  if (updateState === 'checking') {
    return (
      <div className="flex items-center gap-2 px-2">
        <Icon.Refresh className="w-3 h-3 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">Checking...</span>
      </div>
    );
  }

  // Not available state (temporary)
  if (updateState === 'not-available') {
    return (
      <div className="flex items-center gap-2 px-2">
        <Icon.CheckCircle className="w-3 h-3 text-green-500" />
        <span className="text-xs text-muted-foreground">Up to date</span>
      </div>
    );
  }

  // Update available
  if (updateState === 'available' && updateInfo) {
    return (
      <div className="flex flex-col gap-1 px-2 py-1 bg-primary/10 rounded-md border border-primary/20">
        <div className="flex items-center gap-1">
          <Icon.Download className="w-3 h-3 text-primary flex-shrink-0" />
          <span className="text-xs font-medium text-primary">Update available</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">v{updateInfo.version}</span>
          <button
            onClick={handleDownload}
            className="text-xs text-primary hover:underline font-medium"
          >
            Download
          </button>
        </div>
      </div>
    );
  }

  // Downloading
  if (updateState === 'downloading') {
    return (
      <div className="flex flex-col gap-1 px-2 py-1 bg-primary/10 rounded-md border border-primary/20">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-primary">Downloading...</span>
          <span className="text-xs text-muted-foreground">{downloadProgress}%</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${downloadProgress}%` }}
          />
        </div>
      </div>
    );
  }

  // Downloaded - ready to install
  if (updateState === 'downloaded' && updateInfo) {
    return (
      <div className="flex flex-col gap-1 px-2 py-1 bg-green-500/10 rounded-md border border-green-500/20">
        <div className="flex items-center gap-1">
          <Icon.CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
          <span className="text-xs font-medium text-green-600 dark:text-green-400">Ready to install</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">v{updateInfo.version}</span>
          <button
            onClick={handleInstall}
            className="text-xs text-green-600 dark:text-green-400 hover:underline font-medium"
          >
            Install & Restart
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (updateState === 'error') {
    return (
      <div className="flex flex-col gap-1 px-2 py-1 bg-destructive/10 rounded-md border border-destructive/20">
        <div className="flex items-center gap-1">
          <Icon.AlertCircle className="w-3 h-3 text-destructive flex-shrink-0" />
          <span className="text-xs font-medium text-destructive">Update error</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate" title={error}>
            {error || 'Unknown error'}
          </span>
          <button
            onClick={() => setUpdateState('idle')}
            className="text-xs text-primary hover:underline"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}
