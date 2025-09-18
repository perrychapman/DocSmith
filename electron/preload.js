"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
    // Clean up temporary files
    cleanupTempFiles: () => ipcRenderer.invoke('cleanup-temp-files'),
    // Listen for window state changes
    onWindowStateChanged: (callback) => {
        ipcRenderer.on('window-state-changed', (_, state) => callback(state));
        // Return cleanup function
        return () => ipcRenderer.removeAllListeners('window-state-changed');
    },
    // Restore window functionality after setup
    restoreWindow: () => ipcRenderer.invoke('restore-window'),
    // Check if we're running in Electron (useful for conditional logic)
    isElectron: true,
});
