// backend/src/api/sailpoint.ts
import { Router } from "express";
import { getDB } from "../services/storage";
import {
  sailpointRequest,
  getSailpointConfig,
  testSailpointConnection,
  clearSailpointTokenCache,
  type SailpointEnvironment,
  type CustomerSailpointConfigRow
} from "../services/sailpoint";
import { logInfo, logError } from "../utils/logger";

const router = Router();

// Optional debug mount check
router.get("/debug", (_req, res) => res.json({ mounted: true }));

/**
 * GET /api/sailpoint/config/:customerId
 * Get SailPoint configuration for a customer (without secrets)
 */
router.get("/config/:customerId", (req, res) => {
  const db = getDB();
  const customerId = Number(req.params.customerId);
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  db.get<CustomerSailpointConfigRow>(
    'SELECT * FROM customer_sailpoint_config WHERE customerId = ?',
    [customerId],
    (err, row) => {
      if (err) {
        logError('[SAILPOINT] Config fetch error:', err);
        return res.status(500).json({ error: err.message });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Configuration not found' });
      }
      
      // Don't send secrets to frontend
      // Only include environment config if it has values
      const hasSandbox = !!(row.sandboxTenantUrl || row.sandboxClientId || row.sandboxClientSecret);
      const hasProd = !!(row.prodTenantUrl || row.prodClientId || row.prodClientSecret);
      
      res.json({
        customerId: row.customerId,
        sandbox: hasSandbox ? {
          tenantUrl: row.sandboxTenantUrl || '',
          clientId: row.sandboxClientId || '',
          hasSecret: !!row.sandboxClientSecret
        } : null,
        prod: hasProd ? {
          tenantUrl: row.prodTenantUrl || '',
          clientId: row.prodClientId || '',
          hasSecret: !!row.prodClientSecret
        } : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      });
    }
  );
});

/**
 * POST /api/sailpoint/config/:customerId
 * Save or update SailPoint configuration for a customer
 * Allows partial configuration - either sandbox, prod, or both can be configured
 */
router.post("/config/:customerId", (req, res) => {
  const db = getDB();
  const customerId = Number(req.params.customerId);
  const { sandbox, prod } = req.body;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!sandbox && !prod) {
    return res.status(400).json({ error: 'At least one environment configuration required' });
  }
  
  // Validate sandbox if provided - all fields must be complete or all empty
  const hasSandbox = sandbox && (sandbox.tenantUrl || sandbox.clientId || sandbox.clientSecret);
  if (hasSandbox && (!sandbox.tenantUrl || !sandbox.clientId || !sandbox.clientSecret)) {
    return res.status(400).json({ error: 'Sandbox configuration incomplete - all fields required if configuring sandbox' });
  }
  
  // Validate prod if provided - all fields must be complete or all empty
  const hasProd = prod && (prod.tenantUrl || prod.clientId || prod.clientSecret);
  if (hasProd && (!prod.tenantUrl || !prod.clientId || !prod.clientSecret)) {
    return res.status(400).json({ error: 'Production configuration incomplete - all fields required if configuring production' });
  }
  
  const now = new Date().toISOString();
  
  // Check if config exists
  db.get<{ id: number }>(
    'SELECT id FROM customer_sailpoint_config WHERE customerId = ?',
    [customerId],
    (err, existing) => {
      if (err) {
        logError('[SAILPOINT] Config lookup error:', err);
        return res.status(500).json({ error: err.message });
      }
      
      // Prepare values, using empty string as default for unconfigured environments
      const sandboxTenantUrl = hasSandbox ? sandbox.tenantUrl : '';
      const sandboxClientId = hasSandbox ? sandbox.clientId : '';
      const sandboxClientSecret = hasSandbox ? sandbox.clientSecret : '';
      const prodTenantUrl = hasProd ? prod.tenantUrl : '';
      const prodClientId = hasProd ? prod.clientId : '';
      const prodClientSecret = hasProd ? prod.clientSecret : '';
      
      if (existing) {
        // Update existing
        logInfo(`[SAILPOINT] Updating config for customer ${customerId}`);
        db.run(
          `UPDATE customer_sailpoint_config 
           SET sandboxTenantUrl = ?, sandboxClientId = ?, sandboxClientSecret = ?,
               prodTenantUrl = ?, prodClientId = ?, prodClientSecret = ?,
               updatedAt = ?
           WHERE customerId = ?`,
          [
            sandboxTenantUrl, sandboxClientId, sandboxClientSecret,
            prodTenantUrl, prodClientId, prodClientSecret,
            now, customerId
          ],
          (updateErr) => {
            if (updateErr) {
              logError('[SAILPOINT] Config update error:', updateErr);
              return res.status(500).json({ error: updateErr.message });
            }
            res.json({ message: 'Configuration updated', customerId });
          }
        );
      } else {
        // Insert new
        logInfo(`[SAILPOINT] Creating config for customer ${customerId}`);
        db.run(
          `INSERT INTO customer_sailpoint_config 
           (customerId, sandboxTenantUrl, sandboxClientId, sandboxClientSecret,
            prodTenantUrl, prodClientId, prodClientSecret, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            sandboxTenantUrl, sandboxClientId, sandboxClientSecret,
            prodTenantUrl, prodClientId, prodClientSecret,
            now, now
          ],
          (insertErr) => {
            if (insertErr) {
              logError('[SAILPOINT] Config insert error:', insertErr);
              return res.status(500).json({ error: insertErr.message });
            }
            res.json({ message: 'Configuration created', customerId });
          }
        );
      }
    }
  );
});

/**
 * DELETE /api/sailpoint/config/:customerId
 * Delete SailPoint configuration for a customer
 */
router.delete("/config/:customerId", (req, res) => {
  const db = getDB();
  const customerId = Number(req.params.customerId);
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  logInfo(`[SAILPOINT] Deleting config for customer ${customerId}`);
  
  db.run(
    'DELETE FROM customer_sailpoint_config WHERE customerId = ?',
    [customerId],
    (err) => {
      if (err) {
        logError('[SAILPOINT] Config delete error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Configuration deleted', customerId });
    }
  );
});

/**
 * POST /api/sailpoint/:customerId/test
 * Test SailPoint connection for a customer
 * Accepts config inline or fetches from database
 */
router.post("/:customerId/test", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const { environment, config: inlineConfig } = req.body as { 
    environment: SailpointEnvironment;
    config?: { tenantUrl: string; clientId: string; clientSecret: string };
  };
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!environment || !['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment. Must be "sandbox" or "prod"' });
  }
  
  try {
    let config;
    
    // Use inline config if provided (for testing before saving)
    if (inlineConfig && inlineConfig.tenantUrl && inlineConfig.clientId && inlineConfig.clientSecret) {
      config = inlineConfig;
      logInfo(`[SAILPOINT] Testing ${environment} connection with inline config for customer ${customerId}`);
    } else {
      // Fetch from database
      config = await getSailpointConfig(customerId, environment);
      
      if (!config) {
        return res.status(404).json({ error: 'Configuration not found. Provide config in request body to test before saving.' });
      }
      
      logInfo(`[SAILPOINT] Testing ${environment} connection from saved config for customer ${customerId}`);
    }
    
    const success = await testSailpointConnection(config);
    
    if (success) {
      res.json({ success: true, message: 'Connection successful' });
    } else {
      res.status(502).json({ 
        success: false, 
        error: 'Connection test failed' 
      });
    }
  } catch (error: any) {
    logError('[SAILPOINT] Connection test error:', error);
    res.status(502).json({ 
      success: false, 
      error: error.message || 'Connection failed' 
    });
  }
});

/**
 * POST /api/sailpoint/:customerId/:environment/clear-cache
 * Clear token cache for a customer's environment (forces re-authentication)
 */
router.post("/:customerId/:environment/clear-cache", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    clearSailpointTokenCache(config);
    res.json({ message: 'Token cache cleared' });
  } catch (error: any) {
    logError('[SAILPOINT] Clear cache error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sailpoint/:customerId/:environment/sources
 * Get sources from SailPoint ISC
 */
router.get("/:customerId/:environment/sources", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const { limit = '250', offset = '0', filters, sorters } = req.query;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // Build query params
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    
    if (filters) params.append('filters', String(filters));
    if (sorters) params.append('sorters', String(sorters));
    
    const endpoint = `/sources?${params.toString()}`;
    const sources = await sailpointRequest(config, endpoint, 'GET');
    
    res.json(sources);
  } catch (error: any) {
    logError('[SAILPOINT] Sources fetch error:', error);
    const msg = String(error?.message || 'Failed to fetch sources');
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

/**
 * GET /api/sailpoint/:customerId/:environment/identities
 * Get identities from SailPoint ISC
 */
router.get("/:customerId/:environment/identities", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const { limit = '250', offset = '0', filters, sorters } = req.query;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // Build query params
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    
    if (filters) params.append('filters', String(filters));
    if (sorters) params.append('sorters', String(sorters));
    
    const endpoint = `/identities?${params.toString()}`;
    const identities = await sailpointRequest(config, endpoint, 'GET');
    
    res.json(identities);
  } catch (error: any) {
    logError('[SAILPOINT] Identities fetch error:', error);
    const msg = String(error?.message || 'Failed to fetch identities');
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

/**
 * GET /api/sailpoint/:customerId/:environment/roles
 * Get roles from SailPoint ISC
 */
router.get("/:customerId/:environment/roles", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const { limit = '250', offset = '0', filters, sorters } = req.query;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // Build query params
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    
    if (filters) params.append('filters', String(filters));
    if (sorters) params.append('sorters', String(sorters));
    
    const endpoint = `/roles?${params.toString()}`;
    const roles = await sailpointRequest(config, endpoint, 'GET');
    
    res.json(roles);
  } catch (error: any) {
    logError('[SAILPOINT] Roles fetch error:', error);
    const msg = String(error?.message || 'Failed to fetch roles');
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

/**
 * GET /api/sailpoint/:customerId/:environment/access-profiles
 * Get access profiles from SailPoint ISC
 */
router.get("/:customerId/:environment/access-profiles", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const { limit = '250', offset = '0', filters, sorters } = req.query;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // Build query params
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    
    if (filters) params.append('filters', String(filters));
    if (sorters) params.append('sorters', String(sorters));
    
    const endpoint = `/access-profiles?${params.toString()}`;
    const accessProfiles = await sailpointRequest(config, endpoint, 'GET');
    
    res.json(accessProfiles);
  } catch (error: any) {
    logError('[SAILPOINT] Access profiles fetch error:', error);
    const msg = String(error?.message || 'Failed to fetch access profiles');
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

/**
 * Generic GET endpoint for any SailPoint resource
 * GET /api/sailpoint/:customerId/:environment/:resource
 */
router.get("/:customerId/:environment/:resource", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const resource = req.params.resource;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // Build query params from request
    const queryParams = new URLSearchParams();
    Object.entries(req.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    });
    
    const endpoint = queryParams.toString() ? `/${resource}?${queryParams}` : `/${resource}`;
    const data = await sailpointRequest(config, endpoint, 'GET');
    
    res.json(data);
  } catch (error: any) {
    logError(`[SAILPOINT] ${resource} fetch error:`, error);
    const msg = String(error?.message || `Failed to fetch ${resource}`);
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

/**
 * Generic POST endpoint for any SailPoint resource
 * POST /api/sailpoint/:customerId/:environment/:resource
 */
router.post("/:customerId/:environment/:resource", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const resource = req.params.resource;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // SECURITY: This is a direct API route, not chat integration - allow write operations
    const data = await sailpointRequest(config, `/${resource}`, 'POST', req.body, {}, false, false, true);
    
    res.json(data);
  } catch (error: any) {
    logError(`[SAILPOINT] ${resource} create error:`, error);
    const msg = String(error?.message || `Failed to create ${resource}`);
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

/**
 * Generic GET by ID endpoint for any SailPoint resource
 * GET /api/sailpoint/:customerId/:environment/:resource/:id
 */
router.get("/:customerId/:environment/:resource/:id", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const resource = req.params.resource;
  const id = req.params.id;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    const data = await sailpointRequest(config, `/${resource}/${id}`, 'GET');
    
    res.json(data);
  } catch (error: any) {
    logError(`[SAILPOINT] ${resource} get error:`, error);
    const msg = String(error?.message || `Failed to get ${resource}`);
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    const isNotFound = /\b404\b/i.test(msg) || /not found/i.test(msg);
    
    if (isNotFound) {
      return res.status(404).json({ error: `${resource} not found` });
    }
    
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

/**
 * Generic PATCH endpoint for any SailPoint resource
 * PATCH /api/sailpoint/:customerId/:environment/:resource/:id
 */
router.patch("/:customerId/:environment/:resource/:id", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const resource = req.params.resource;
  const id = req.params.id;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // SECURITY: This is a direct API route, not chat integration - allow write operations
    const data = await sailpointRequest(config, `/${resource}/${id}`, 'PATCH', req.body, {}, false, false, true);
    
    res.json(data);
  } catch (error: any) {
    logError(`[SAILPOINT] ${resource} update error:`, error);
    const msg = String(error?.message || `Failed to update ${resource}`);
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

/**
 * Generic DELETE endpoint for any SailPoint resource
 * DELETE /api/sailpoint/:customerId/:environment/:resource/:id
 */
router.delete("/:customerId/:environment/:resource/:id", async (req, res) => {
  const customerId = Number(req.params.customerId);
  const environment = req.params.environment as SailpointEnvironment;
  const resource = req.params.resource;
  const id = req.params.id;
  
  if (!customerId || isNaN(customerId)) {
    return res.status(400).json({ error: 'Invalid customer ID' });
  }
  
  if (!['sandbox', 'prod'].includes(environment)) {
    return res.status(400).json({ error: 'Invalid environment' });
  }
  
  try {
    const config = await getSailpointConfig(customerId, environment);
    
    if (!config) {
      return res.status(404).json({ error: 'Configuration not found' });
    }
    
    // SECURITY: This is a direct API route, not chat integration - allow write operations
    await sailpointRequest(config, `/${resource}/${id}`, 'DELETE', undefined, {}, false, false, true);
    
    res.json({ message: `${resource} deleted successfully` });
  } catch (error: any) {
    logError(`[SAILPOINT] ${resource} delete error:`, error);
    const msg = String(error?.message || `Failed to delete ${resource}`);
    const isForbidden = /\b403\b/i.test(msg) || /forbidden/i.test(msg);
    res.status(isForbidden ? 403 : 502).json({
      error: isForbidden ? 'Invalid API credentials' : msg
    });
  }
});

export default router;
