// backend/src/services/sailpoint.ts
import { getDB } from "./storage";
import { logError, logInfo } from "../utils/logger";

export type SailpointEnvironment = 'sandbox' | 'prod';

export interface SailpointConfig {
  tenantUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface SailpointTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CustomerSailpointConfigRow {
  id: number;
  customerId: number;
  sandboxTenantUrl: string;
  sandboxClientId: string;
  sandboxClientSecret: string;
  prodTenantUrl: string;
  prodClientId: string;
  prodClientSecret: string;
  createdAt: string;
  updatedAt: string;
}

// Token cache to avoid repeated authentication
// Key: "tenantUrl:clientId", Value: { token, expiresAt }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Get SailPoint configuration for a customer and environment
 */
export async function getSailpointConfig(
  customerId: number,
  environment: SailpointEnvironment
): Promise<SailpointConfig | null> {
  const db = getDB();
  
  return new Promise((resolve, reject) => {
    db.get<CustomerSailpointConfigRow>(
      'SELECT * FROM customer_sailpoint_config WHERE customerId = ?',
      [customerId],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        
        const config: SailpointConfig = {
          tenantUrl: environment === 'sandbox' ? row.sandboxTenantUrl : row.prodTenantUrl,
          clientId: environment === 'sandbox' ? row.sandboxClientId : row.prodClientId,
          clientSecret: environment === 'sandbox' ? row.sandboxClientSecret : row.prodClientSecret
        };
        
        resolve(config);
      }
    );
  });
}

/**
 * Get OAuth access token for SailPoint ISC
 * Uses cached token if still valid (with 60s buffer)
 */
async function getAccessToken(config: SailpointConfig): Promise<string> {
  const cacheKey = `${config.tenantUrl}:${config.clientId}`;
  const cached = tokenCache.get(cacheKey);
  
  // Return cached token if still valid (with 60s buffer)
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }
  
  try {
    const authUrl = `${config.tenantUrl}/oauth/token`;
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret
    });
    
    logInfo(`[SAILPOINT] Authenticating to ${config.tenantUrl}`);
    
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Authentication failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
    }
    
    const data: SailpointTokenResponse = await response.json();
    
    // Cache the token
    tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000)
    });
    
    logInfo(`[SAILPOINT] Authentication successful, token expires in ${data.expires_in}s`);
    
    return data.access_token;
  } catch (error) {
    logError('[SAILPOINT] Authentication failed:', error);
    throw error;
  }
}

/**
 * Make authenticated request to SailPoint ISC API
 * Similar to anythingllmRequest pattern but for SailPoint
 * Automatically retries once on 401 Unauthorized by clearing cache and re-authenticating
 * Handles 429 Rate Limit errors with exponential backoff
 * SECURITY: Only GET requests are allowed from chat integration
 */
export async function sailpointRequest<T = any>(
  config: SailpointConfig,
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: any,
  extraHeaders: Record<string, string> = {},
  isRetry: boolean = false,
  returnHeaders: boolean = false,
  allowWriteOperations: boolean = false, // Explicit flag required for write operations
  retryCount: number = 0,
  maxRetries: number = 5
): Promise<T> {
  // SECURITY: Block write operations unless explicitly allowed
  const writeOperations = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (writeOperations.includes(method) && !allowWriteOperations) {
    logError(`[SAILPOINT] SECURITY: Blocked write operation: ${method} ${endpoint}`);
    throw new Error(`Security violation: Write operations (${method}) are not allowed from chat integration. Only GET requests are permitted.`);
  }
  
  const token = await getAccessToken(config);
  
  // Ensure endpoint starts with /
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  // Use v2025 API (latest stable) instead of beta
  const url = `${config.tenantUrl}/v2025${path}`;
  
  const retryInfo = retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : '';
  logInfo(`[SAILPOINT] ${method} ${path}${isRetry ? ' (auth retry)' : ''}${retryInfo}`);
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    ...extraHeaders
  };
  
  let requestBody: any;
  if (body) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: requestBody
    });
    
    // Handle 401 Unauthorized - token may have been revoked or expired
    if (response.status === 401 && !isRetry) {
      logInfo(`[SAILPOINT] Got 401, clearing token cache and retrying`);
      clearSailpointTokenCache(config);
      return sailpointRequest<T>(config, endpoint, method, body, extraHeaders, true, returnHeaders, allowWriteOperations, retryCount, maxRetries);
    }
    
    // Handle 429 Rate Limit - retry with exponential backoff
    if (response.status === 429) {
      if (retryCount >= maxRetries) {
        const errorText = await response.text().catch(() => '');
        logError(`[SAILPOINT] Rate limit exceeded after ${maxRetries} retries: ${method} ${url}`);
        throw new Error(`SailPoint API error: 429 Too Many Requests for ${method} ${path}${errorText ? ` - ${errorText}` : ''}`);
      }
      
      // Check for Retry-After header
      const retryAfterHeader = response.headers.get('Retry-After');
      let delayMs: number;
      
      if (retryAfterHeader) {
        // Retry-After can be in seconds or a date
        const retryAfterSeconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(retryAfterSeconds)) {
          delayMs = retryAfterSeconds * 1000;
        } else {
          // Try parsing as date
          const retryAfterDate = new Date(retryAfterHeader);
          delayMs = Math.max(0, retryAfterDate.getTime() - Date.now());
        }
      } else {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        delayMs = Math.min(1000 * Math.pow(2, retryCount), 30000); // Cap at 30s
      }
      
      logInfo(`[SAILPOINT] Rate limited (429), waiting ${delayMs}ms before retry ${retryCount + 1}/${maxRetries}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      // Retry the request
      return sailpointRequest<T>(config, endpoint, method, body, extraHeaders, isRetry, returnHeaders, allowWriteOperations, retryCount + 1, maxRetries);
    }
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logError(`[SAILPOINT] Request failed: ${method} ${url} -> ${response.status} ${response.statusText}`);
      throw new Error(`SailPoint API error: ${response.status} ${response.statusText} for ${method} ${path}${errorText ? ` - ${errorText}` : ''}`);
    }
    
    // If headers requested, collect them first (needed for 204 responses)
    let responseHeaders: Record<string, string> | undefined;
    if (returnHeaders) {
      responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders![key.toLowerCase()] = value;
      });
    }
    
    // Handle empty responses (e.g., 204 No Content)
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      if (returnHeaders && responseHeaders) {
        return { data: {}, headers: responseHeaders } as T;
      }
      return {} as T;
    }
    
    const jsonData = await response.json();
    
    // If headers requested, return both data and headers
    if (returnHeaders && responseHeaders) {
      return { data: jsonData, headers: responseHeaders } as T;
    }
    
    return jsonData;
  } catch (error) {
    logError(`[SAILPOINT] Request failed:`, error);
    throw error;
  }
}

/**
 * Clear cached token for a config (useful for forced re-authentication)
 */
export function clearSailpointTokenCache(config: SailpointConfig): void {
  const cacheKey = `${config.tenantUrl}:${config.clientId}`;
  tokenCache.delete(cacheKey);
  logInfo(`[SAILPOINT] Token cache cleared for ${config.tenantUrl}`);
}

/**
 * Test SailPoint connection by making a simple API call
 */
export async function testSailpointConnection(config: SailpointConfig): Promise<boolean> {
  try {
    // Test with identities endpoint - always available, even in empty tenants
    await sailpointRequest(config, '/identities?limit=1', 'GET');
    return true;
  } catch (error) {
    logError('[SAILPOINT] Connection test failed:', error);
    return false;
  }
}
