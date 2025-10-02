
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

// ES module-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Wait for backend to be ready by polling health endpoint
async function waitForBackend(port: number, maxAttempts: number = 30, delayMs: number = 500): Promise<boolean> {
  logToFile(`Waiting for backend on port ${port} (max ${maxAttempts} attempts)...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000)
      });
      
      if (response.ok) {
        logToFile(`Backend ready on port ${port} after ${attempt} attempt(s)`);
        return true;
      }
      
      logToFile(`Backend health check attempt ${attempt}/${maxAttempts} - status ${response.status}`);
    } catch (error) {
      // Backend not ready yet, will retry
      if (attempt === 1 || attempt % 5 === 0) {
        logToFile(`Backend health check attempt ${attempt}/${maxAttempts} - not ready yet`);
      }
    }
    
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  logToFile(`Backend failed to start after ${maxAttempts} attempts`);
  return false;
}

// Log configuration
const LOG_PATH = path.join(os.tmpdir(), 'docsmith-electron.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_LINES = 10000; // Keep last 10,000 lines

function cleanupLogs() {
  try {
    // Clean up various temporary files that DocSmith and related tools might create
    const tempDir = os.tmpdir();
    const files = fs.readdirSync(tempDir);
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    let deletedSize = 0;
    
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      
      try {
        const stats = fs.statSync(filePath);
        
        // Clean up DocSmith-specific files older than 7 days
        if (file.startsWith('docsmith-electron') && file.endsWith('.log') && stats.mtime.getTime() < sevenDaysAgo) {
          fs.unlinkSync(filePath);
          deletedCount++;
          deletedSize += stats.size;
          logToFile(`Deleted old DocSmith log: ${file} (${(stats.size / 1024).toFixed(1)}KB)`);
          return;
        }
        
        // Clean up Pandoc temp directories older than 3 days
        if (file.startsWith('docsmith-pandoc-') && stats.isDirectory() && stats.mtime.getTime() < threeDaysAgo) {
          fs.rmSync(filePath, { recursive: true, force: true });
          deletedCount++;
          logToFile(`Deleted old Pandoc temp dir: ${file}`);
          return;
        }
        
        // Clean up old ts-node cache directories older than 7 days (from development)
        if (file.startsWith('.ts-node') && stats.isDirectory() && stats.mtime.getTime() < sevenDaysAgo) {
          fs.rmSync(filePath, { recursive: true, force: true });
          deletedCount++;
          logToFile(`Deleted old ts-node cache: ${file}`);
          return;
        }
        
        // Clean up Node.js compile cache if very old (14 days)
        const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
        if ((file === 'node-compile-cache' || file === 'node-jiti') && stats.isDirectory() && stats.mtime.getTime() < fourteenDaysAgo) {
          fs.rmSync(filePath, { recursive: true, force: true });
          deletedCount++;
          logToFile(`Deleted old Node.js cache: ${file}`);
          return;
        }
        
      } catch (err) {
        // Ignore errors for individual files (might be in use, permission issues, etc.)
      }
    });

    if (deletedCount > 0) {
      logToFile(`Cleanup completed: ${deletedCount} items deleted (${(deletedSize / 1024).toFixed(1)}KB freed)`);
    }

    // Handle current log file rotation
    if (!fs.existsSync(LOG_PATH)) {
      logToFile('Log cleanup completed - new log file created');
      return;
    }

    const stats = fs.statSync(LOG_PATH);
    const content = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = content.split('\n');
    
    // Check if log file needs trimming (by size OR by line count)
    const needsSizeTrim = stats.size > MAX_LOG_SIZE;
    const needsLineTrim = lines.length > MAX_LOG_LINES;
    
    if (needsSizeTrim || needsLineTrim) {
      // Keep last MAX_LOG_LINES lines
      const trimmedLines = lines.slice(-MAX_LOG_LINES);
      const trimmedContent = trimmedLines.join('\n');
      
      fs.writeFileSync(LOG_PATH, trimmedContent);
      const reason = needsSizeTrim ? 'size limit' : 'line limit';
      logToFile(`Log rotation completed - trimmed from ${lines.length} to ${trimmedLines.length} lines (${reason})`);
    } else {
      logToFile(`Log check completed - current size: ${(stats.size / 1024).toFixed(1)}KB, lines: ${lines.length}`);
    }
  } catch (error) {
    console.error('Failed to cleanup temp files:', error);
    // Create a simple log entry even if cleanup failed
    try {
      logToFile('Temp cleanup failed but logging continues');
    } catch (logError) {
      console.error('Failed to write to log:', logError);
    }
  }
}

function logToFile(message: string) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_PATH, `[${timestamp}] ${message}\n`);
}

async function createWindow() {
  // Clean up logs on startup
  cleanupLogs();
  
  const win = new BrowserWindow({
    width: 600,  // Smaller width to fit card content
    height: 750, // Increased height to fit welcome step content
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      autoplayPolicy: 'user-gesture-required',
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // Don't show until ready
    autoHideMenuBar: true, // Start with menu bar hidden for setup
    frame: false, // Start with no window frame for setup
    titleBarStyle: 'hidden', // Hide title bar for setup
    resizable: false, // Prevent resizing during setup
    center: true, // Center the window on screen
  });

  // Show window when ready to reduce loading artifacts
  win.once('ready-to-show', () => {
    win.show();
    logToFile('Window shown');
  });

  // Window state change listeners
  win.on('maximize', () => {
    win.webContents.send('window-state-changed', { isMaximized: true });
  });

  win.on('unmaximize', () => {
    win.webContents.send('window-state-changed', { isMaximized: false });
  });

  const distPath = path.join(__dirname, '../frontend/dist/index.html');
  let backendProcess: import('child_process').ChildProcess | undefined;
  
  // Log the path we're checking for
  logToFile('Checking for static build at: ' + distPath);
  logToFile('Static build exists: ' + fs.existsSync(distPath));
  
  // Check if we're in a packaged app (app.asar exists) or explicit production mode
  const isPackaged = __dirname.includes('app.asar');
  const isProduction = process.env.NODE_ENV === 'production' || isPackaged;
  const backendPort = isProduction ? 3000 : 4000;
  
  logToFile('Is packaged app: ' + isPackaged);
  logToFile('Is production mode: ' + isProduction);

  // Logging for debugging
  logToFile('Electron app starting...');
  logToFile('NODE_ENV: ' + process.env.NODE_ENV);
  logToFile('Development check: ' + (process.env.NODE_ENV !== 'production'));

  // Only open dev tools in development mode
  if (!isProduction && process.env.ELECTRON_DEV === 'true') {
    win.webContents.openDevTools();
    logToFile('Dev tools opened');
  }

  // Suppress console errors we can't control (like autofill)
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    // Filter out autofill-related errors
    if (message.includes('Autofill') || message.includes('autofill') || 
        sourceId.includes('devtools://') || message.includes('protocol_client')) {
      return; // Don't log these
    }
    // Log other console messages normally
    logToFile(`Console ${level}: ${message}`);
  });

  // Handle web contents errors
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logToFile(`Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });

  // Disable autofill and other unwanted features
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`
      // Disable autofill warnings in console (only if not already done)
      if (!window.__docsmithConsoleOverridden) {
        window.__docsmithConsoleOverridden = true;
        const originalConsoleError = console.error;
        console.error = function(...args) {
          const message = args.join(' ');
          if (message.includes('Autofill') || message.includes('autofill')) {
            return; // Suppress autofill errors
          }
          originalConsoleError.apply(console, args);
        };
      }
      
      // Disable Chrome runtime if present
      if (window.chrome && window.chrome.runtime) {
        window.chrome.runtime.onMessage = () => {};
      }
    `).catch(() => {
      // Ignore injection errors
    });
  });

  
  if (!isProduction) {
    logToFile('Development mode - waiting for backend to be ready...');
    
    // Wait for backend to be ready before loading frontend
    const backendReady = await waitForBackend(backendPort);
    
    if (!backendReady) {
      logToFile('Backend failed to start, showing error page');
      await win.loadURL('data:text/html,<h1>DocSmith</h1><p style="color:red;">Backend server failed to start.</p><p>Please check the logs and ensure the backend is running on port ' + backendPort + '.</p>');
      return;
    }
    
    logToFile('Backend ready, loading Vite dev server at http://localhost:5173');
    
    // Try to load Vite dev server, with fallback to static build if it fails
    const loadDevServer = async () => {
      try {
        // Use Promise.race to implement timeout
        await Promise.race([
          win.loadURL('http://localhost:5173'),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 5000)
          )
        ]);
        logToFile('Successfully loaded Vite dev server');
      } catch (error) {
        logToFile('Failed to load Vite dev server, falling back to static build');
        if (fs.existsSync(distPath)) {
          await win.loadFile(distPath);
          logToFile('Loaded static build as fallback');
        } else {
          logToFile('No static build available, loading error page');
          await win.loadURL('data:text/html,<h1>DocSmith</h1><p>Development server not running and no static build found.</p><p>Run <code>npm run dev</code> to start the development server.</p>');
        }
      }
    };
    
    loadDevServer().catch((err) => {
      logToFile('Critical error loading application: ' + err.toString());
    });
  } else {
    // Start backend server on port 3000 in production
    logToFile('Starting backend on port ' + backendPort);
    
    // In production, the backend files are inside the asar archive
    // We need to extract or use the original source since we can't run from asar directly
    const backendPath = isPackaged 
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'dist', 'server.js')
      : path.join(__dirname, '../backend/dist/server.js');
    
    logToFile('Backend path: ' + backendPath);
    logToFile('Backend exists: ' + fs.existsSync(backendPath));
    
    backendProcess = spawn('node', [backendPath], {
      env: { 
        ...process.env, 
        PORT: '3000',
        NODE_ENV: 'production'
      },
      cwd: isPackaged 
        ? path.join(process.resourcesPath, 'app.asar.unpacked')
        : path.join(__dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    backendProcess.stdout?.on('data', (data) => {
      logToFile('Backend stdout: ' + data.toString());
    });
    
    backendProcess.stderr?.on('data', (data) => {
      logToFile('Backend stderr: ' + data.toString());
    });
    
    backendProcess.on('error', (err: Error) => {
      logToFile('Failed to start backend: ' + err.toString());
    });
    
    backendProcess.on('exit', (code, signal) => {
      logToFile(`Backend process exited with code ${code} and signal ${signal}`);
    });
    
    // Wait for backend to be ready before loading frontend
    logToFile('Production mode - waiting for backend to be ready...');
    const backendReady = await waitForBackend(backendPort, 60, 500); // 30 seconds timeout
    
    if (!backendReady) {
      logToFile('Backend failed to start in production mode');
      await win.loadURL('data:text/html,<h1>DocSmith</h1><p style="color:red;">Backend server failed to start.</p><p>Please check the logs for more information.</p>');
      return;
    }
    
    logToFile('Backend ready in production mode');
    
    // Try to load static build, fallback to dev server if missing
    if (fs.existsSync(distPath)) {
      logToFile('Loading static build: ' + distPath);
      await win.loadFile(distPath);
    } else {
      logToFile('Static build not found, loading Vite dev server at http://localhost:5173');
      await win.loadURL('http://localhost:5173');
    }
  }

  // Store reference to backend process for cleanup
  let cleanupPromise: Promise<void> | null = null;

  // Graceful shutdown of backend process
  async function shutdownBackend(): Promise<void> {
    if (!backendProcess || backendProcess.killed) {
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logToFile('Backend shutdown timeout, force killing...');
        if (!backendProcess?.killed) {
          backendProcess?.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      backendProcess?.on('exit', () => {
        clearTimeout(timeout);
        logToFile('Backend process exited gracefully');
        resolve();
      });

      // Try graceful shutdown first
      logToFile('Sending SIGTERM to backend process...');
      backendProcess?.kill('SIGTERM');
    });
  }

  // Cleanly shutdown backend process on app exit
  app.on('before-quit', async (event) => {
    if (backendProcess && !backendProcess.killed && !cleanupPromise) {
      event.preventDefault();
      logToFile('App closing, shutting down backend...');
      
      cleanupPromise = shutdownBackend();
      await cleanupPromise;
      
      logToFile('Backend shutdown complete, closing app...');
      app.quit();
    }
  });

  // Handle window close
  win.on('closed', async () => {
    if (backendProcess && !backendProcess.killed && !cleanupPromise) {
      logToFile('Window closed, shutting down backend...');
      cleanupPromise = shutdownBackend();
      await cleanupPromise;
    }
  });
}

// Set up IPC handlers
ipcMain.handle('setup-completed', () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    logToFile('Setup completed - showing menu bar and restoring window functionality');
    win.setAutoHideMenuBar(false);
    win.setMenuBarVisibility(true);
    win.setResizable(true);
    
    // Resize window to normal application size after setup
    win.setSize(1200, 800);
    win.center(); // Re-center the larger window
  }
});

ipcMain.handle('restore-window', () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    logToFile('Restoring full window functionality');
    win.setAutoHideMenuBar(false);
    win.setMenuBarVisibility(true);
    win.setResizable(true);
    // Note: Frame cannot be changed after window creation in Electron
  }
});

ipcMain.handle('setup-status', () => {
  // Check if setup is completed by trying to read from renderer
  // This will be called when the renderer loads
  logToFile('Setup status requested from renderer');
});

ipcMain.handle('get-setup-status', async () => {
  // We can't directly access localStorage from main process
  // This will be used by renderer to communicate setup status
  logToFile('Get setup status called from renderer');
  return false; // Default to false, renderer will update this
});

ipcMain.handle('close-app', () => {
  logToFile('Close app requested from renderer');
  app.quit();
});

ipcMain.handle('minimize-app', () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    logToFile('Minimize app requested from renderer');
    win.minimize();
  }
});

ipcMain.handle('maximize-app', () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    logToFile('Maximize app requested from renderer');
    if (win.isMaximized()) {
      win.restore();
    } else {
      win.maximize();
    }
  }
});

ipcMain.handle('get-window-state', () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) {
    return {
      isMaximized: win.isMaximized(),
      isMinimized: win.isMinimized(),
      isFullScreen: win.isFullScreen()
    };
  }
  return { isMaximized: false, isMinimized: false, isFullScreen: false };
});

ipcMain.handle('open-path', async (_event, filePath: string) => {
  try {
    if (!filePath) {
      return { success: false, error: 'Missing file path' };
    }
    logToFile(`Request to open path: ${filePath}`);
    const result = await shell.openPath(filePath);
    if (result) {
      logToFile(`Failed to open path: ${result}`);
      return { success: false, error: result };
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logToFile(`Error opening path: ${message}`);
    return { success: false, error: message };
  }
});
    
ipcMain.handle('reveal-logs', () => {
  try {
    // Ensure log file exists
    if (!fs.existsSync(LOG_PATH)) {
      logToFile('Log file does not exist, creating it');
      // Create the log file if it doesn't exist
      fs.writeFileSync(LOG_PATH, `DocSmith Electron Log\nCreated: ${new Date().toISOString()}\n\n`);
    }
    
    // Check if file exists after creation
    if (fs.existsSync(LOG_PATH)) {
      logToFile('Log file exists, attempting to reveal in file manager');
      // Show the log file in the system's file manager
      shell.showItemInFolder(LOG_PATH);
      logToFile('Log file revealed in file manager successfully');
      return { success: true };
    } else {
      logToFile('Log file still does not exist after creation attempt');
      return { success: false, error: 'Could not create or find log file' };
    }
  } catch (error) {
    const errorMsg = `Error revealing log file: ${error}`;
    logToFile(errorMsg);
    console.error(errorMsg);
    return { success: false, error: `Failed to reveal log file: ${error instanceof Error ? error.message : String(error)}` };
  }
});

ipcMain.handle('cleanup-temp-files', () => {
  try {
    logToFile('Manual temp file cleanup requested');
    
    const tempDir = os.tmpdir();
    const files = fs.readdirSync(tempDir);
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    let deletedSize = 0;
    const deletedItems: string[] = [];
    
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      
      try {
        const stats = fs.statSync(filePath);
        let shouldDelete = false;
        let reason = '';
        
        // Clean up Pandoc temp directories older than 1 hour (more aggressive for manual cleanup)
        if (file.startsWith('docsmith-pandoc-') && stats.isDirectory()) {
          const oneHourAgo = Date.now() - (60 * 60 * 1000);
          if (stats.mtime.getTime() < oneHourAgo) {
            shouldDelete = true;
            reason = 'Old Pandoc temp directory';
          }
        }
        
        // Clean up ts-node cache directories older than 3 days
        else if (file.startsWith('.ts-node') && stats.isDirectory() && stats.mtime.getTime() < threeDaysAgo) {
          shouldDelete = true;
          reason = 'Old ts-node cache';
        }
        
        // Clean up old DocSmith logs
        else if (file.startsWith('docsmith-electron') && file.endsWith('.log') && stats.mtime.getTime() < sevenDaysAgo) {
          shouldDelete = true;
          reason = 'Old DocSmith log';
        }
        
        if (shouldDelete) {
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
          deletedCount++;
          deletedSize += stats.size || 0;
          deletedItems.push(`${file} (${reason})`);
        }
        
      } catch (err) {
        // Ignore errors for individual files
      }
    });

    const sizeFreedMB = (deletedSize / (1024 * 1024)).toFixed(2);
    const resultMsg = `Manual cleanup completed: ${deletedCount} items deleted, ${sizeFreedMB}MB freed`;
    logToFile(resultMsg);
    
    if (deletedItems.length > 0) {
      logToFile(`Deleted items: ${deletedItems.join(', ')}`);
    }
    
    return { 
      success: true, 
      deletedCount,
      sizeFreedMB: parseFloat(sizeFreedMB),
      message: resultMsg
    };
  } catch (error) {
    const errorMsg = `Error during manual cleanup: ${error}`;
    logToFile(errorMsg);
    console.error(errorMsg);
    return { success: false, error: `Failed to cleanup temp files: ${error instanceof Error ? error.message : String(error)}` };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Additional cleanup for unexpected exits
process.on('SIGINT', async () => {
  logToFile('Received SIGINT, cleaning up...');
  app.quit();
});

process.on('SIGTERM', async () => {
  logToFile('Received SIGTERM, cleaning up...');
  app.quit();
});

process.on('exit', (code) => {
  logToFile(`Electron process exiting with code: ${code}`);
});

