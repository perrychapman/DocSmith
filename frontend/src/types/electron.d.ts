// Global type definitions for DocSmith frontend

interface ElectronAPI {
  setupCompleted: () => Promise<void>;
  getSetupStatus: () => Promise<boolean>;
  closeApp: () => Promise<void>;
  minimizeApp: () => Promise<void>;
  maximizeApp: () => Promise<void>;
  getWindowState: () => Promise<{ isMaximized: boolean; isMinimized: boolean; isFullScreen: boolean }>;
  onWindowStateChanged: (callback: (state: { isMaximized: boolean }) => void) => () => void;
  restoreWindow: () => Promise<void>;
  revealLogs: () => Promise<{ success: boolean; error?: string }>;
  openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
