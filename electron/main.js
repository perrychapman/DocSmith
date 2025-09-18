import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
// ES module-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Log configuration
const LOG_PATH = path.join(os.tmpdir(), 'docsmith-electron.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_LINES = 10000; // Keep last 10,000 lines
function cleanupLogs() {
    try {
        // Clean up old log files (older than 7 days)
        const tempDir = os.tmpdir();
        const files = fs.readdirSync(tempDir);
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        files.forEach(file => {
            if (file.startsWith('docsmith-electron') && file.endsWith('.log')) {
                const filePath = path.join(tempDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (stats.mtime.getTime() < sevenDaysAgo) {
                        fs.unlinkSync(filePath);
                        console.log(`Deleted old log file: ${file}`);
                    }
                }
                catch (err) {
                    // Ignore errors for individual files
                }
            }
        });
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
            logToFile(`Log cleanup completed - trimmed from ${lines.length} to ${trimmedLines.length} lines (${reason})`);
        }
        else {
            logToFile(`Log cleanup completed - current size: ${(stats.size / 1024).toFixed(1)}KB, lines: ${lines.length}`);
        }
    }
    catch (error) {
        console.error('Failed to cleanup logs:', error);
        // Create a simple log entry even if cleanup failed
        try {
            logToFile('Log cleanup failed but logging continues');
        }
        catch (logError) {
            console.error('Failed to write to log:', logError);
        }
    }
}
function logToFile(message) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_PATH, `[${timestamp}] ${message}\n`);
}
function createWindow() {
    // Clean up logs on startup
    cleanupLogs();
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            experimentalFeatures: false,
            autoplayPolicy: 'user-gesture-required',
        },
        show: false, // Don't show until ready
    });
    // Show window when ready to reduce loading artifacts
    win.once('ready-to-show', () => {
        win.show();
        logToFile('Window shown');
    });
    const distPath = path.join(__dirname, '../frontend/dist/index.html');
    let backendProcess;
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
        logToFile('Loading Vite dev server at http://localhost:5173');
        // Try to load Vite dev server, with fallback to static build if it fails
        const loadDevServer = async () => {
            try {
                // Use Promise.race to implement timeout
                await Promise.race([
                    win.loadURL('http://localhost:5173'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                ]);
                logToFile('Successfully loaded Vite dev server');
            }
            catch (error) {
                logToFile('Failed to load Vite dev server, falling back to static build');
                if (fs.existsSync(distPath)) {
                    await win.loadFile(distPath);
                    logToFile('Loaded static build as fallback');
                }
                else {
                    logToFile('No static build available, loading error page');
                    await win.loadURL('data:text/html,<h1>DocSmith</h1><p>Development server not running and no static build found.</p><p>Run <code>npm run dev</code> to start the development server.</p>');
                }
            }
        };
        loadDevServer().catch((err) => {
            logToFile('Critical error loading application: ' + err.toString());
        });
    }
    else {
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
        backendProcess.on('error', (err) => {
            logToFile('Failed to start backend: ' + err.toString());
        });
        backendProcess.on('exit', (code, signal) => {
            logToFile(`Backend process exited with code ${code} and signal ${signal}`);
        });
        // Try to load static build, fallback to dev server if missing
        if (fs.existsSync(distPath)) {
            logToFile('Loading static build: ' + distPath);
            win.loadFile(distPath);
        }
        else {
            logToFile('Static build not found, loading Vite dev server at http://localhost:5173');
            win.loadURL('http://localhost:5173');
        }
    }
    // Store reference to backend process for cleanup
    let cleanupPromise = null;
    // Graceful shutdown of backend process
    async function shutdownBackend() {
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
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
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
