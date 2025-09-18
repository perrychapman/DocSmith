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
      restoreWindow: () => Promise<void>;
      isElectron: boolean;
    };
  }
}