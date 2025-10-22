// backend/src/services/anythingllmDiscovery.ts
import { readSettings, writeSettings } from './settings';
import { logInfo, logError } from '../utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get list of listening ports on the system (Windows/Mac/Linux compatible)
 */
async function getListeningPorts(): Promise<number[]> {
  try {
    const platform = process.platform;
    let command: string;
    
    if (platform === 'win32') {
      // Windows: Use netstat
      command = 'netstat -an | findstr LISTENING';
    } else if (platform === 'darwin') {
      // macOS: Use lsof
      command = 'lsof -iTCP -sTCP:LISTEN -n -P';
    } else {
      // Linux: Use ss or netstat
      command = 'ss -tln || netstat -tln';
    }
    
    const { stdout } = await execAsync(command);
    const ports = new Set<number>();
    
    // Parse output to extract port numbers
    const lines = stdout.split('\n');
    for (const line of lines) {
      // Match patterns like :3001, 0.0.0.0:52974, [::]:3000, etc.
      const matches = line.match(/:(\d+)\s/g);
      if (matches) {
        for (const match of matches) {
          const port = parseInt(match.replace(/[:\s]/g, ''));
          if (port >= 3000 && port <= 70000) {
            ports.add(port);
          }
        }
      }
    }
    
    return Array.from(ports).sort((a, b) => a - b);
  } catch (error) {
    logError(`[DISCOVERY] Failed to get listening ports: ${error}`);
    return [];
  }
}

/**
 * Discover AnythingLLM Desktop API port by scanning common ports
 * Desktop uses dynamic ephemeral ports (typically 50000-70000 range)
 * 
 * Production-safe: Uses direct port testing instead of netstat
 */
export async function discoverAnythingLLMPort(): Promise<number | null> {
  logInfo('[DISCOVERY] Searching for AnythingLLM Desktop API...');
  
  try {
    // Common ports to try first (faster) - ordered by likelihood
    const commonPorts = [
      3001,   // Default AnythingLLM port (MOST COMMON - check first!)
      3002,   // Alternative AnythingLLM port
      3000,   // Common dev port
      64685,  // Known Desktop port
      52974,  // Previously observed ephemeral port
      49152,  // Start of typical ephemeral range
      50000,  // Common ephemeral start
      60000,  // Mid-range ephemeral
    ];
    logInfo(`[DISCOVERY] Testing common ports: ${commonPorts.join(', ')}`);
    
    for (const port of commonPorts) {
      const isValid = await testAnythingLLMPort(port);
      if (isValid) {
        logInfo(`[DISCOVERY] Found AnythingLLM API on common port ${port}`);
        return port;
      }
    }
    
    // Try to get actual listening ports from the system (fast!)
    logInfo('[DISCOVERY] Checking system listening ports...');
    const listeningPorts = await getListeningPorts();
    
    if (listeningPorts.length > 0) {
      logInfo(`[DISCOVERY] Found ${listeningPorts.length} listening ports, testing for AnythingLLM...`);
      
      // Test listening ports that aren't in common ports already
      const portsToTest = listeningPorts.filter(p => !commonPorts.includes(p));
      
      for (const port of portsToTest) {
        const isValid = await testAnythingLLMPort(port);
        if (isValid) {
          logInfo(`[DISCOVERY] Found AnythingLLM API on listening port ${port}`);
          return port;
        }
      }
    }
    
    // Fallback: Scan ephemeral port ranges more thoroughly
    // Windows ephemeral: 49152-65535, Linux: 32768-60999
    // Sample every 50 ports for better coverage while staying fast
    logInfo('[DISCOVERY] System scan unsuccessful, falling back to port range sampling...');
    const samplePorts: number[] = [];
    
    // Scan Windows ephemeral range (49152-65535)
    for (let port = 49152; port < 65535; port += 50) {
      samplePorts.push(port);
    }
    
    // Scan typical Desktop high range (additional coverage)
    for (let port = 65535; port < 70000; port += 100) {
      samplePorts.push(port);
    }
    
    logInfo(`[DISCOVERY] Sampling ephemeral port range (${samplePorts.length} ports)`);
    
    for (const port of samplePorts) {
      const isValid = await testAnythingLLMPort(port);
      if (isValid) {
        logInfo(`[DISCOVERY] Found AnythingLLM API on port ${port}`);
        // Once we find a valid port in a range, scan nearby ports more thoroughly
        const nearbyPort = await scanNearbyPorts(port, 50);
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
  const startPort = Math.max(49152, centerPort - range);
  const endPort = Math.min(70000, centerPort + range);
  
  logInfo(`[DISCOVERY] Scanning nearby ports ${startPort}-${endPort} around ${centerPort}`);
  
  for (let port = startPort; port <= endPort; port++) {
    if (port === centerPort) continue; // Already tested
    const isValid = await testAnythingLLMPort(port);
    if (isValid) {
      logInfo(`[DISCOVERY] Found better match at port ${port}`);
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
