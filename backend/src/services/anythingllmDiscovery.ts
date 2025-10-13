// backend/src/services/anythingllmDiscovery.ts
import { readSettings, writeSettings } from './settings';
import { logInfo, logError } from '../utils/logger';

/**
 * Discover AnythingLLM Desktop API port by scanning common ports
 * Desktop uses dynamic ephemeral ports (typically 50000-70000 range)
 * 
 * Production-safe: Uses direct port testing instead of netstat
 */
export async function discoverAnythingLLMPort(): Promise<number | null> {
  logInfo('[DISCOVERY] Searching for AnythingLLM Desktop API...');
  
  try {
    // Common ports to try first (faster)
    const commonPorts = [3001, 3002, 64685, 3000];
    logInfo(`[DISCOVERY] Testing common ports: ${commonPorts.join(', ')}`);
    
    for (const port of commonPorts) {
      const isValid = await testAnythingLLMPort(port);
      if (isValid) {
        logInfo(`[DISCOVERY] Found AnythingLLM API on common port ${port}`);
        return port;
      }
    }
    
    // Scan typical Desktop range (sample every 100 ports for speed)
    // Full scan would take too long (20,000 ports * 2s timeout = hours)
    const samplePorts: number[] = [];
    for (let port = 50000; port < 70000; port += 100) {
      samplePorts.push(port);
    }
    
    logInfo(`[DISCOVERY] Sampling Desktop port range (${samplePorts.length} ports)`);
    
    for (const port of samplePorts) {
      const isValid = await testAnythingLLMPort(port);
      if (isValid) {
        logInfo(`[DISCOVERY] Found AnythingLLM API on port ${port}`);
        // Once we find a valid port in a range, scan nearby ports
        const nearbyPort = await scanNearbyPorts(port, 100);
        return nearbyPort || port;
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
 * Scan ports near a discovered port (more thorough)
 */
async function scanNearbyPorts(centerPort: number, range: number): Promise<number | null> {
  const startPort = Math.max(50000, centerPort - range);
  const endPort = Math.min(70000, centerPort + range);
  
  for (let port = startPort; port <= endPort; port++) {
    if (port === centerPort) continue; // Already tested
    const isValid = await testAnythingLLMPort(port);
    if (isValid) {
      return port;
    }
  }
  
  return null;
}

/**
 * Test if a port hosts the AnythingLLM API
 */
async function testAnythingLLMPort(port: number): Promise<boolean> {
  try {
    const settings = await readSettings();
    const apiKey = settings.anythingLLMKey;
    
    if (!apiKey) {
      // Silent fail - no key means we can't test
      return false;
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500); // 500ms timeout for faster scanning
    
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
    // Port not responding or wrong service - silent fail
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
