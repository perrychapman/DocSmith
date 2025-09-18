
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

// ES module-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function logToFile(message: string) {
  const logPath = path.join(os.tmpdir(), 'docsmith-electron.log');
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Logging for debugging
  logToFile('Electron app starting...');
  logToFile('NODE_ENV: ' + process.env.NODE_ENV);
  logToFile('Development check: ' + (process.env.NODE_ENV !== 'production'));

  // Open dev tools for debugging
  win.webContents.openDevTools();

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
  
  if (!isProduction) {
    logToFile('Loading Vite dev server at http://localhost:5173');
    win.loadURL('http://localhost:5173');
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
      cwd: path.dirname(backendPath),
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
    // Try to load static build, fallback to dev server if missing
    if (fs.existsSync(distPath)) {
      logToFile('Loading static build: ' + distPath);
      win.loadFile(distPath);
    } else {
      logToFile('Static build not found, loading Vite dev server at http://localhost:5173');
      win.loadURL('http://localhost:5173');
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
