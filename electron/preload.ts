const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Notify main process when setup is completed
  setupCompleted: () => ipcRenderer.invoke('setup-completed'),
  
  // Get initial setup status
  getSetupStatus: () => ipcRenderer.invoke('get-setup-status'),
  
  // Close the application
  closeApp: () => ipcRenderer.invoke('close-app'),
  
  // Minimize the application
  minimizeApp: () => ipcRenderer.invoke('minimize-app'),
  
  // Maximize/restore the application
  maximizeApp: () => ipcRenderer.invoke('maximize-app'),
  
  // Get current window state
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  
  // Reveal application logs in file manager
  revealLogs: () => ipcRenderer.invoke('reveal-logs'),
  
  // Open a file or folder in the OS default handler
  openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath),

  // Clean up temporary files
  cleanupTempFiles: () => ipcRenderer.invoke('cleanup-temp-files'),
  
  // Listen for window state changes
  onWindowStateChanged: (callback: (state: { isMaximized: boolean }) => void) => {
    ipcRenderer.on('window-state-changed', (_: any, state: { isMaximized: boolean }) => callback(state));
    
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners('window-state-changed');
  },
  
  // Restore window functionality after setup
  restoreWindow: () => ipcRenderer.invoke('restore-window'),
  
  // Check if we're running in Electron (useful for conditional logic)
  isElectron: true,
});

// Export to make this a module
export {};

declare global {
  interface Window {
    electronAPI: {
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
    };
  }
}
