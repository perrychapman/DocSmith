// backend/src/services/anythingllmDiscovery.ts
import { exec } from 'child_process';
import { promisify } from 'util';
import { readSettings, writeSettings } from './settings';
import { logInfo, logError } from '../utils/logger';

const execAsync = promisify(exec);

/**
 * Discover AnythingLLM Desktop API port by scanning common ports
 * Desktop uses dynamic ephemeral ports (typically 50000-70000 range)
 */
export async function discoverAnythingLLMPort(): Promise<number | null> {
  logInfo('[DISCOVERY] Searching for AnythingLLM Desktop API...');
  
  try {
    // Get listening ports from netstat (cross-platform approach)
    const { stdout } = await execAsync(
      process.platform === 'win32'
        ? 'netstat -ano | findstr "LISTENING"'
        : 'netstat -an | grep LISTEN'
    );
    
    // Extract port numbers in typical AnythingLLM range
    const portMatches = stdout.matchAll(/:(\d+)\s/g);
    const candidatePorts: number[] = [];
    
    for (const match of portMatches) {
      const port = parseInt(match[1]);
      // AnythingLLM Desktop typically uses ports 50000-70000
      if (port >= 50000 && port < 70000) {
        candidatePorts.push(port);
      }
    }
    
    logInfo(`[DISCOVERY] Found ${candidatePorts.length} candidate ports in range 50000-70000`);
    
    // Test each candidate port for AnythingLLM API
    for (const port of candidatePorts) {
      const isValid = await testAnythingLLMPort(port);
      if (isValid) {
        logInfo(`[DISCOVERY] Found AnythingLLM API on port ${port}`);
        return port;
      }
    }
    
    // Fallback: Try common/default ports
    const fallbackPorts = [3001, 3002, 64685];
    logInfo(`[DISCOVERY] Trying fallback ports: ${fallbackPorts.join(', ')}`);
    
    for (const port of fallbackPorts) {
      const isValid = await testAnythingLLMPort(port);
      if (isValid) {
        logInfo(`[DISCOVERY] Found AnythingLLM API on fallback port ${port}`);
        return port;
      }
    }
    
    logError('[DISCOVERY] Could not find AnythingLLM API on any port');
    return null;
  } catch (error) {
    logError(`[DISCOVERY] Error during port discovery: ${error}`);
    return null;
  }
}

/**
 * Test if a port hosts the AnythingLLM API
 */
async function testAnythingLLMPort(port: number): Promise<boolean> {
  try {
    const settings = await readSettings();
    const apiKey = settings.anythingLLMKey;
    
    if (!apiKey) {
      logError('[DISCOVERY] No API key configured, cannot test ports');
      return false;
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // 2s timeout
    
    const response = await fetch(`http://localhost:${port}/api/v1/auth`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (response.ok) {
      const data = await response.json();
      return data.authenticated === true;
    }
    
    return false;
  } catch (error) {
    // Port not responding or wrong service
    return false;
  }
}

/**
 * Auto-update settings with discovered port
 */
export async function autoConfigureAnythingLLM(): Promise<boolean> {
  const port = await discoverAnythingLLMPort();
  
  if (port) {
    const settings = await readSettings();
    const newUrl = `http://localhost:${port}`;
    
    if (settings.anythingLLMUrl !== newUrl) {
      logInfo(`[DISCOVERY] Updating AnythingLLM URL from ${settings.anythingLLMUrl} to ${newUrl}`);
      await writeSettings({ ...settings, anythingLLMUrl: newUrl });
    }
    
    return true;
  }
  
  return false;
}

/**
 * Periodically check if AnythingLLM port has changed (Desktop restarts)
 */
export function startAnythingLLMMonitor(intervalMs: number = 60000): NodeJS.Timeout {
  logInfo('[DISCOVERY] Starting AnythingLLM port monitor (checks every 60s)');
  
  return setInterval(async () => {
    const settings = await readSettings();
    const currentUrl = settings.anythingLLMUrl;
    
    if (!currentUrl) return;
    
    // Test if current URL still works
    const currentPortMatch = currentUrl.match(/:(\d+)/);
    if (currentPortMatch) {
      const currentPort = parseInt(currentPortMatch[1]);
      const stillValid = await testAnythingLLMPort(currentPort);
      
      if (!stillValid) {
        logInfo('[DISCOVERY] Current AnythingLLM port no longer responding, searching for new port...');
        await autoConfigureAnythingLLM();
      }
    }
  }, intervalMs);
}
