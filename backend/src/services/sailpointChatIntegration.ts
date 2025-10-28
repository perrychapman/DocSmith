// backend/src/services/sailpointChatIntegration.ts
// Intelligent SailPoint integration for chat - injects function calling capabilities

import { sailpointRequest, getSailpointConfig } from './sailpoint';
import { SAILPOINT_API_MAP } from './sailpoint-api-map';
import { getDB } from './storage';
import { logInfo, logError } from '../utils/logger';
import { correctFilter, validateFilter, getFilterDocumentation } from './sailpoint-api-filters';

interface SailPointContext {
  customerId: number;
  customerName: string;
  environment: 'sandbox' | 'prod';
}

/**
 * Extract customer context from workspace slug (async version)
 * Convention: workspace slugs are like "dev-customername_month_year"
 */
export async function getCustomerFromWorkspace(workspaceSlug: string): Promise<SailPointContext | null> {
  return new Promise((resolve) => {
    try {
      const db = getDB();
      
      logInfo(`[SAILPOINT_CHAT] Looking for customer with workspace: ${workspaceSlug}`);
      
      // Get all customers
      db.all('SELECT id, name, workspaceSlug FROM customers', [], (err, customers: any[]) => {
        if (err || !customers) {
          logError('[SAILPOINT_CHAT] Error fetching customers:', err);
          return resolve(null);
        }
        
        logInfo(`[SAILPOINT_CHAT] Found ${customers.length} customers`);
        customers.forEach(c => logInfo(`[SAILPOINT_CHAT]   - ${c.name} (${c.id}): ${c.workspaceSlug || 'no workspace'}`));
        
        // Check each customer for workspace match and SailPoint config
        let checked = 0;
        for (const customer of customers) {
          if (customer.workspaceSlug && workspaceSlug.includes(customer.workspaceSlug)) {
            logInfo(`[SAILPOINT_CHAT] Workspace match found for customer ${customer.name}`);
            // Check if SailPoint config exists
            db.get(
              'SELECT sandboxTenantUrl, prodTenantUrl FROM customer_sailpoint_config WHERE customerId = ? LIMIT 1',
              [customer.id],
              (configErr, config: any) => {
                if (!configErr && config) {
                  // Determine which environment to use (prefer prod, fallback to sandbox)
                  const hasProd = !!(config.prodTenantUrl);
                  const hasSandbox = !!(config.sandboxTenantUrl);
                  
                  if (hasProd || hasSandbox) {
                    const environment = hasProd ? 'prod' : 'sandbox';
                    logInfo(`[SAILPOINT_CHAT] SailPoint config found for ${customer.name}: ${environment}`);
                    return resolve({
                      customerId: customer.id,
                      customerName: customer.name,
                      environment
                    });
                  } else {
                    logInfo(`[SAILPOINT_CHAT] SailPoint config exists but no environments configured for ${customer.name}`);
                  }
                } else {
                  logInfo(`[SAILPOINT_CHAT] No SailPoint config for ${customer.name}`);
                }
                
                checked++;
                if (checked === customers.length) {
                  resolve(null);
                }
              }
            );
          } else {
            checked++;
            if (checked === customers.length) {
              resolve(null);
            }
          }
        }
        
        if (customers.length === 0) {
          resolve(null);
        }
      });
    } catch (error) {
      logError('[SAILPOINT_CHAT] Error getting customer from workspace:', error);
      resolve(null);
    }
  });
}

/**
 * Build system prompt that teaches LLM about SailPoint functions
 */
export function buildSailPointSystemPrompt(): string {
  return `
SAILPOINT IDENTITY SECURITY CLOUD INTEGRATION:
You have access to query SailPoint IdentityNow data for this customer's environment.

⚠️  **CRITICAL FILTER RULE - READ FIRST**:
The TRANSFORMS endpoint has LIMITED filter support:
- ONLY supports: "name eq \"exact\"" OR "name sw \"prefix\""  
- NEVER use: "name co \"text\"" - this will cause API errors
- For partial matching on transforms: ALWAYS use 'sw' (starts with) NOT 'co' (contains)
Example: ✅ "name sw \"Cornerstone\"" | ❌ "name co \"Cornerstone\""

🔄 **AUTOMATIC FILTER CORRECTION & RETRY**:
If you accidentally use an unsupported filter operator:
1. The system will AUTO-CORRECT it and retry (e.g., 'co' → 'sw' for transforms)
2. You'll receive the corrected results with metadata about what was changed
3. The response will include: filterCorrected: true, filterCorrections: ["details"]
4. When you see this, INFORM the user about the correction made
5. If a query returns 0 results with a filter, the system may auto-retry with corrections

Example response with correction:
{
  "data": [...results...],
  "filterCorrected": true,
  "originalFilter": "name co \"Cornerstone\"",
  "correctedFilter": "name sw \"Cornerstone\"",
  "filterCorrections": ["Changed 'name co' to 'name sw' (contains not supported, using starts-with)"]
}

When you see this, tell the user:
"I found X transforms starting with 'Cornerstone' (note: I used 'starts with' instead of 'contains' 
since the transforms endpoint doesn't support contains matching)"

QUERY PATTERN:
Use <sailpoint_query> tags with JSON to query any SailPoint resource.

SUPPORTED ACTIONS:
1. count_{resource} - Get total count of a resource type
2. search_{resource} - Search/list resources with optional filters and full JSON details
3. get_{resource} - Get a specific resource by ID (requires "id" field)

AVAILABLE RESOURCES:
- identities (users/people in the system)
- accounts (application/source accounts)  
- entitlements (permissions/access rights)
- roles (RBAC roles)
- access-profiles (collections of entitlements)
- sources (connected applications/systems)
- certifications (access reviews)
- certification-campaigns (review campaigns)
- workflows (automation workflows)
- transforms (data transformations)
- governance-groups (workgroups)
- sod-policies (segregation of duties policies)
- sod-violations (policy violations)
- work-items (pending tasks)
- account-activities (account change events)
- account-aggregations (aggregation jobs)
- account-usages (account usage data)
- segments (identity segments)
- connectors (source connectors)
- connector-rules (connector transformation rules)
- access-requests (access requests)
- access-request-approvals (pending approvals)
- role-insights (role recommendations)
- triggers (event triggers)
- custom-forms (custom forms)
- identity-attributes (custom identity attributes)
- identity-profiles (identity profile configurations)
- lifecycle-states (lifecycle state definitions)
- managed-clients (managed clients)
- managed-clusters (managed clusters/VAs)
- notifications (notification templates)
- oauth-clients (OAuth applications)
- org-config (organization configuration)
- password-configuration (password policies)
- password-dictionary (password dictionary)
- password-management (password operations)
- password-sync-groups (password sync groups)
- personal-access-tokens (PATs)
- public-identities-config (public identity settings)
- requestable-objects (requestable items)
- search-attribute-configuration (search config)
- service-desk-integration (service desk connectors)
- source-usages (source usage data)
- sp-config (tenant configuration export/import)
- tagged-objects (tagged resources)
- task-management (task status)
- work-reassignment (work item reassignment)
- non-employee-records (non-employee lifecycle)
- non-employee-approvals (non-employee requests)
- identity-history (historical identity snapshots)
- recommendations-access-request (IAI access recommendations)
- outliers (IAI access outliers)
- peer-group-strategies (IAI peer groups)
- role-mining-sessions (IAI role mining)
- mfa-duo-config, mfa-okta-config, mfa-kba-config (MFA settings)

IMPORTANT: All resources support count_ and search_ actions. Most support get_ by ID.

QUERY FORMAT:
<sailpoint_query>
{
  "action": "count_{resource} | search_{resource} | get_{resource}",
  "filters": "SCIM filter string (optional for search)",
  "limit": 250,
  "offset": 0,
  "id": "resource-id (required for get_ actions)",
  "description": "What you're looking for"
}
</sailpoint_query>

PAGINATION:
SailPoint APIs return paginated results. Each search response includes:
- data: Array of items (up to limit)
- totalCount: Total items available
- offset: Starting position
- hasMore: Boolean indicating if more pages exist

PAGINATION STRATEGY - UNLIMITED INTELLIGENT CHUNKING:
When you receive a response with hasMore=true:

**FOR FIRST QUERY:**
1. INFORM the user about the total count
2. Tell them you retrieved the first page
3. ASK if they want you to fetch all pages
4. WAIT for user confirmation

**WHEN USER CONFIRMS "YES" or "FETCH ALL":**
1. Generate MULTIPLE <sailpoint_query> tags in a SINGLE response
2. Calculate offsets intelligently (offset = page * 250)
3. Generate as MANY queries as necessary to complete the full dataset
4. For very large datasets (>10,000 items), you can generate dozens or hundreds of queries
5. All queries will execute in parallel with progress tracking shown to the user

Example - User says "yes fetch all" after seeing 750 total:
<sailpoint_query>{"action":"search_roles","limit":250,"offset":250,"description":"Page 2 of 3"}</sailpoint_query>
<sailpoint_query>{"action":"search_roles","limit":250,"offset":500,"description":"Page 3 of 3"}</sailpoint_query>

Example - User says "yes fetch all" after seeing 12,565 total:
Generate ALL 50 queries with offsets: 250, 500, 750, 1000... up to 12,500
The system will handle the execution and show progress to the user.

**AGGREGATION QUERIES:**
When user asks for "breakdown by source" or similar:
- You will receive aggregated summaries for large datasets (>100 items)
- Use the BREAKDOWN BY SOURCE section in the results
- No need to see every individual item to provide counts

IMPORTANT: Do NOT fetch all pages on the FIRST query. Always ask first!
When user confirms, generate ALL pagination queries in ONE response for efficiency.

IMPORTANT - ANALYZING RESULTS:
When you receive query results, you'll get the FULL JSON objects from SailPoint.
Each object contains detailed fields you should analyze:

=== CORE IDENTITY & ACCESS RESOURCES ===

**IDENTITIES** (users/people in the system):
- id, name, email, alias
- manager: {id, name, type}
- attributes: {department, location, title, etc.}
- accounts: [list of accounts across systems]
- inactive, protected, isManager (boolean flags)
Use for: User searches, manager lookups, department analysis

**ACCOUNTS** (system accounts belonging to identities):
- id, name, nativeIdentity
- identityId, sourceId, sourceName
- disabled, locked, uncorrelated (boolean flags)
- attributes: system-specific attributes
Use for: Account inventories, orphaned account detection, system access analysis

**ENTITLEMENTS** (permissions/groups in source systems):
- id, name, description, value, attribute
- source: {id, name, type}
- privileged, requestable, cloud (boolean flags)
- owner: {id, name}
Use for: Permission inventories, privileged access reviews, entitlement analysis

**ROLES** (business roles with collections of access):
- id, name, description
- owner: {id, name, type}
- source: {id, name, type} - WHERE THIS ROLE COMES FROM
- accessProfiles: [{id, name, source}] - Access profiles in this role
- membership: {type, criteria}
- requestable (boolean)
Use for: Role analysis, access profile relationships, role membership

**ACCESS PROFILES** (groups of entitlements):
- id, name, description
- source: {id, name} - THE SOURCE SYSTEM
- entitlements: [{id, name, type}]
- owner: {id, name}
- requestable, enabled (boolean)
Use for: Access packaging, entitlement groupings, source analysis

**SOURCES** (connected systems/applications):
- id, name, description, type
- connectorAttributes: {configuration details}
- owner: {id, name}
- healthy, status, connectionType
- accountCorrelationConfig, entitlementCorrelationConfig
Use for: System inventories, connector health, integration analysis

=== REQUEST & APPROVAL RESOURCES ===

**ACCESS REQUESTS** (requests for access):
- id, requestedFor: {id, name}
- requestedItems: [{type, id, name}]
- requestType: GRANT_ACCESS, REVOKE_ACCESS
- state, priority, created
Use for: Access request tracking, approval workflows

**ACCESS REQUEST APPROVALS** (pending approvals):
- id, requestedFor: {id, name}
- requestedObjectId, requestedObjectName, requestedObjectType
- state: PENDING, APPROVED, REJECTED
- approvalSummary, clientMetadata
Use for: Approval queue management, decision tracking

**WORK ITEMS** (tasks assigned to users):
- id, type, state
- requesterName, name, description
- created, modified
- completionStatus, approvalType
Use for: Task management, workflow tracking

=== GOVERNANCE & COMPLIANCE RESOURCES ===

**CERTIFICATIONS** (access review tasks):
- id, name, campaign: {id, name}
- phase: SIGNED, ACTIVE, STAGED
- completed, decisionsMade, decisionsTotal
- identitySummary: {id, name}
- reviewer: {id, name}
Use for: Access certification campaigns, review progress

**CERTIFICATION CAMPAIGNS** (access review campaigns):
- id, name, description, type
- status: PENDING, ACTIVE, COMPLETED
- deadline, created, modified
- certificationsCount
Use for: Campaign management, compliance tracking

**GOVERNANCE GROUPS** (groups for governance workflows):
- id, name, description
- owner: {id, name}
- memberCount, members
Use for: Governance organization, group membership

**SOD POLICIES** (segregation of duties policies):
- id, name, description
- state: ENABLED, DISABLED
- conflictingAccessCriteria
- violationOwner, violationOwnerAssignmentConfig
Use for: SOD policy management, conflict detection

**SOD VIOLATIONS** (detected SOD conflicts):
- id, policyId, policyName
- identityId, identityName
- conflictingAccessDetails
- state: ACTIVE, REMEDIATED
Use for: Violation tracking, remediation

**SEGMENTS** (identity segments for targeting):
- id, name, description
- owner: {id, name}
- visibilityCriteria, active
Use for: Segment analysis, targeting rules

=== WORKFLOW & AUTOMATION RESOURCES ===

**WORKFLOWS** (automation workflows):
- id, name, description
- enabled, executionCount
- owner: {id, name}
- trigger: {type, attributes}
Use for: Workflow management, automation tracking

**TRANSFORMS** (data transformation rules):
- id, name, type
- attributes: {configuration}
- internal (boolean - system vs custom)
⚠️  **CRITICAL**: Transforms endpoint ONLY supports 'eq' and 'sw' operators for name field
   - Use "name sw \"prefix\"" for partial matching (NOT "name co \"text\"")
   - Use "name eq \"exact name\"" for exact matching
   - The 'co' (contains) operator WILL FAIL on transforms endpoint
Use for: Transform management, data mapping configuration

=== TECHNICAL RESOURCES ===

**CONNECTORS** (connector definitions):
- id, name, type, scriptName
- className, features, directConnect
Use for: Connector inventory, capability analysis

**ACCOUNT ACTIVITIES** (audit events):
- id, type, action, created
- sourceId, targetId, actorId
- status, warnings, errors
Use for: Audit trails, event analysis, troubleshooting

EXAMPLES BY RESOURCE TYPE:

**Identities:**
- Count: <sailpoint_query>{"action":"count_identities","description":"Getting total identity count"}</sailpoint_query>
- Search: <sailpoint_query>{"action":"search_identities","limit":100,"description":"Getting all identities"}</sailpoint_query>
- Filter: <sailpoint_query>{"action":"search_identities","filters":"email sw \\"john\\" and inactive eq false","description":"Finding active users"}</sailpoint_query>

**Roles:**
- Count: <sailpoint_query>{"action":"count_roles","description":"Getting total role count"}</sailpoint_query>
- Search: <sailpoint_query>{"action":"search_roles","limit":100,"description":"Getting all roles with sources"}</sailpoint_query>
- Filter: <sailpoint_query>{"action":"search_roles","filters":"source.name eq \\"Active Directory\\"","description":"Finding AD roles"}</sailpoint_query>

**Access Profiles:**
- Count: <sailpoint_query>{"action":"count_access-profiles","description":"Getting access profile count"}</sailpoint_query>
- Search: <sailpoint_query>{"action":"search_access-profiles","filters":"source.id eq \\"2c9180867....\\"","description":"Finding profiles for specific source"}</sailpoint_query>

**Entitlements:**
- Count: <sailpoint_query>{"action":"count_entitlements","description":"Getting entitlement count"}</sailpoint_query>
- Filter: <sailpoint_query>{"action":"search_entitlements","filters":"privileged eq true","description":"Finding privileged entitlements"}</sailpoint_query>

**Sources:**
- List all: <sailpoint_query>{"action":"search_sources","limit":100,"description":"Getting all connected sources"}</sailpoint_query>
- Filter: <sailpoint_query>{"action":"search_sources","filters":"healthy eq false","description":"Finding unhealthy sources"}</sailpoint_query>

**Access Requests:**
- Recent: <sailpoint_query>{"action":"search_access-requests","limit":50,"description":"Getting recent access requests"}</sailpoint_query>

**Work Items:**
- Pending: <sailpoint_query>{"action":"search_work-items","filters":"state eq \\"PENDING\\"","description":"Finding pending work items"}</sailpoint_query>

**Certifications:**
- Active: <sailpoint_query>{"action":"search_certifications","filters":"phase eq \\"ACTIVE\\"","description":"Finding active certifications"}</sailpoint_query>

**Transforms:**
- ⚠️  **CRITICAL - READ THIS**: Transforms ONLY support 'eq' and 'sw' operators (NOT 'co')
- Count: <sailpoint_query>{"action":"count_transforms","description":"Getting transform count"}</sailpoint_query>
- Search by prefix: <sailpoint_query>{"action":"search_transforms","filters":"name sw \\"Cornerstone\\"","description":"Finding transforms starting with Cornerstone"}</sailpoint_query>
- Exact match: <sailpoint_query>{"action":"search_transforms","filters":"name eq \\"Transform Name\\"","description":"Finding specific transform"}</sailpoint_query>
- ❌ NEVER USE: "name co \"text\"" - This will FAIL on transforms endpoint!

**SOD Violations:**
- Active: <sailpoint_query>{"action":"search_sod-violations","filters":"state eq \\"ACTIVE\\"","description":"Finding active SOD violations"}</sailpoint_query>

ANALYZING BREAKDOWNS:
When asked to "break down by source" or similar:
1. Request the full data set with search_{resource}
2. You'll receive complete JSON objects
3. Group by the requested field (e.g., source.name, owner.name)
4. Present results in natural language with counts per group

SCIM FILTER EXAMPLES:
⚠️  IMPORTANT: Different endpoints support different filter operators!

**TRANSFORMS ENDPOINT - SPECIAL RULES** ⚠️:
❌ NEVER USE: "name co \"text\"" - API will reject with "Match mode not supported" error
✅ ALWAYS USE: "name sw \"text\"" (starts with) for partial matching
✅ OR USE: "name eq \"exact name\"" for exact matching

Example correct transforms queries:
- name sw "Cornerstone" ✅ (finds: Cornerstone-*, Cornerstonexyz, etc.)
- name eq "Cornerstone-Transform-1" ✅ (exact match only)
- name co "Cornerstone" ❌ WILL FAIL!

**MOST OTHER ENDPOINTS** (roles, identities, access-profiles):
These support full SCIM operators:
- name eq "John Doe" - Exact match
- name co "John" - Contains (SUPPORTED on these endpoints)
- email sw "john" - Starts with  
- source.name eq "Active Directory" - Filter by source
- owner.name co "Smith" - Filter by owner (if supported)
- attribute eq "value" and otherAttr co "text" - Multiple conditions

FILTER OPERATOR REFERENCE:
- eq: equals (exact match) - ALWAYS SUPPORTED
- sw: starts with - USUALLY SUPPORTED for text fields
- co: contains - NOT ALWAYS SUPPORTED (check endpoint docs)
- ge/le: greater/less than or equal - for dates/numbers
- gt/lt: greater/less than - for dates/numbers

GUIDELINES:
- Use snake_case for action names (e.g., sod_policies, access_profiles)
- Always provide a description
- Default limit is 250, adjust based on need (increase for aggregations)
- Query results include FULL JSON with all fields
- Look at nested objects like source, owner, accessProfiles
- Interpret and aggregate results naturally for the user
- When breaking down data, group by the relevant field from the JSON

When you receive query results, they will be provided as complete JSON objects. 
Analyze all fields including nested objects, then present findings in natural language.
`.trim();
}

/**
 * Parse LLM response for SailPoint function calls
 */
export function extractSailPointQueries(llmResponse: string): Array<{
  action: string;
  filters?: string;
  limit?: number;
  description?: string;
}> {
  const queries: Array<any> = [];
  const regex = /<sailpoint_query>([\s\S]*?)<\/sailpoint_query>/g;
  
  let match;
  while ((match = regex.exec(llmResponse)) !== null) {
    try {
      const queryJson = match[1].trim();
      const query = JSON.parse(queryJson);
      queries.push(query);
    } catch (error) {
      logError('[SAILPOINT_CHAT] Failed to parse query:', match[1]);
    }
  }
  
  return queries;
}

// Map of endpoint paths that support counting via X-Total-Count header
// These endpoints return X-Total-Count when count=true parameter is used
const COUNTABLE_ENDPOINTS = [
  // Core Identity & Access
  'identities', 
  'accounts', 
  'entitlements', 
  'roles', 
  'sources', 
  'access-profiles',
  
  // Requests & Approvals
  'access-requests',
  'access-request-approvals',
  'work-items',
  
  // Certifications & Governance
  'certifications', 
  'certification-campaigns',
  'governance-groups', 
  'sod-policies', 
  'sod-violations',
  'segments',
  
  // Workflows & Transforms
  'workflows', 
  'transforms',
  
  // Technical & Audit
  'connectors',
  'account-activities'
];

/**
 * Execute a SailPoint query based on the action
 * Supports pattern-based actions: count_{resource}, search_{resource}, get_{resource}
 * SECURITY: Only read-only operations are allowed
 */
export async function executeSailPointQuery(
  context: SailPointContext,
  query: {
    action: string;
    filters?: string;
    limit?: number;
    offset?: number;
    id?: string;
    description?: string;
  }
): Promise<any> {
  const config = await getSailpointConfig(context.customerId, context.environment);
  if (!config) {
    throw new Error('SailPoint configuration not found');
  }
  
  const { action, filters: rawFilters, limit = 250, offset = 0, id } = query;
  
  // SECURITY: Validate that action is read-only
  // Allow: count_, search_, get_, list_ (list is equivalent to search)
  const readOnlyPatterns = /^(count_|search_|get_|list_)/;
  if (!readOnlyPatterns.test(action)) {
    logError(`[SAILPOINT_CHAT] SECURITY: Blocked non-read-only action: ${action}`);
    throw new Error(`Security violation: Only read-only operations (count_, search_, get_, list_) are allowed. Attempted action: ${action}`);
  }
  
  logInfo(`[SAILPOINT_CHAT] Executing ${action} for customer ${context.customerId}, env: ${context.environment}`);
  
  try {
    // Pattern: count_{resource}
    const countMatch = action.match(/^count_(.+)$/);
    if (countMatch) {
      const resource = countMatch[1].replace(/_/g, '-'); // Convert snake_case to kebab-case
      
      if (COUNTABLE_ENDPOINTS.includes(resource)) {
        let basePath = `/${resource}`;
        
        // CRITICAL: Apply filters to count queries (e.g., count accounts by source)
        let filters = null;
        if (rawFilters) {
          const { corrected, wasModified, changes } = correctFilter(resource, rawFilters);
          filters = wasModified ? corrected : rawFilters;
          
          if (wasModified) {
            logInfo(`[SAILPOINT_CHAT] Filter auto-corrected for count query:`);
            changes.forEach(change => logInfo(`  - ${change}`));
          }
          
          logInfo(`[SAILPOINT_CHAT] Count query with filter: ${filters}`);
        }
        
        // For filtered counts, we need to fetch all matching items and count them
        // because X-Total-Count header may not respect filters on some endpoints
        if (filters) {
          logInfo(`[SAILPOINT_CHAT] Fetching all filtered ${resource} to get accurate count`);
          
          let allItems: any[] = [];
          let offset = 0;
          const pageSize = 250; // Reasonable page size
          let hasMore = true;
          
          while (hasMore) {
            const path = `${basePath}?limit=${pageSize}&offset=${offset}&filters=${encodeURIComponent(filters)}&count=true`;
            logInfo(`[SAILPOINT_CHAT] API call: GET ${path}`);
            
            const result: any = await sailpointRequest(config, path, 'GET', undefined, {}, false, true);
            const pageItems = result.data || [];
            allItems.push(...pageItems);
            
            const totalCount = parseInt(result.headers?.['x-total-count'] || '0', 10);
            offset += pageItems.length;
            
            // Stop if we got fewer items than requested or reached total
            hasMore = pageItems.length === pageSize && offset < totalCount;
            
            logInfo(`[SAILPOINT_CHAT] Fetched ${pageItems.length} items (${offset}/${totalCount} total)`);
            
            // Safety limit to prevent infinite loops
            if (allItems.length >= 10000) {
              logInfo(`[SAILPOINT_CHAT] Hit safety limit of 10,000 items for count query`);
              break;
            }
          }
          
          const count = allItems.length;
          logInfo(`[SAILPOINT_CHAT] Final filtered count for ${resource}: ${count}`);
          return { count, type: 'count', resource };
        } else {
          // No filter - can trust X-Total-Count header
          const path = `${basePath}?count=true&limit=1`;
          logInfo(`[SAILPOINT_CHAT] API call: GET ${path}`);
          const result: any = await sailpointRequest(config, path, 'GET', undefined, {}, false, true);
          const count = parseInt(result.headers?.['x-total-count'] || '0', 10);
          logInfo(`[SAILPOINT_CHAT] ${resource} count from header: ${count}`);
          return { count, type: 'count', resource };
        }
      }
    }
    
    // Pattern: search_{resource} OR list_{resource} (both are equivalent)
    const searchMatch = action.match(/^(search|list)_(.+)$/);
    if (searchMatch) {
      const resource = searchMatch[2].replace(/_/g, '-');
      let path = `/${resource}?limit=${limit}`;
      if (offset > 0) path += `&offset=${offset}`;
      
      // Auto-correct filters if needed
      let filters = rawFilters;
      let filterCorrectionApplied = false;
      let filterCorrectionDetails: string[] = [];
      
      if (filters) {
        const { corrected, wasModified, changes } = correctFilter(resource, filters);
        
        if (wasModified) {
          logInfo(`[SAILPOINT_CHAT] Filter auto-corrected for ${resource}:`);
          changes.forEach(change => logInfo(`  - ${change}`));
          filters = corrected;
          filterCorrectionApplied = true;
          filterCorrectionDetails = changes;
        }
        
        path += `&filters=${encodeURIComponent(filters)}`;
      }
      
      logInfo(`[SAILPOINT_CHAT] API call: GET ${path}`);
      
      // Get both data and total count for pagination awareness
      const result: any = await sailpointRequest(config, `${path.includes('?') ? path + '&' : path + '?'}count=true`, 'GET', undefined, {}, false, true);
      const data = result.data;
      const totalCount = parseInt(result.headers?.['x-total-count'] || '0', 10);
      const returnedCount = Array.isArray(data) ? data.length : 0;
      
      logInfo(`[SAILPOINT_CHAT] Retrieved ${returnedCount} ${resource} (total available: ${totalCount}, offset: ${offset})`);
      
      const response: any = { 
        data, 
        type: resource, 
        count: returnedCount,
        totalCount,
        offset,
        limit,
        hasMore: (offset + returnedCount) < totalCount
      };
      
      // Include filter correction info if applied
      if (filterCorrectionApplied) {
        response.filterCorrected = true;
        response.filterCorrections = filterCorrectionDetails;
        response.originalFilter = rawFilters;
        response.correctedFilter = filters;
      }
      
      return response;
    }
    
    // Pattern: get_{resource} (requires id)
    const getMatch = action.match(/^get_(.+)$/);
    if (getMatch) {
      if (!id) {
        throw new Error(`get_${getMatch[1]} requires an 'id' parameter. Use search_${getMatch[1]} with filters instead, or provide an id.`);
      }
      
      const resource = getMatch[1].replace(/_/g, '-');
      const path = `/${resource}/${id}`;
      
      logInfo(`[SAILPOINT_CHAT] API call: GET ${path}`);
      const data = await sailpointRequest(config, path, 'GET');
      logInfo(`[SAILPOINT_CHAT] Retrieved ${resource} with id: ${id}`);
      return { data, type: resource, id };
    }
    
    // Fallback for unmatched actions
    throw new Error(`Unsupported action: ${action}. Use count_{resource}, list_{resource}, search_{resource}, or get_{resource} (with id parameter)`);
  } catch (error: any) {
    logError(`[SAILPOINT_CHAT] Query execution failed:`, error);
    throw error;
  }
}

/**
 * Format query results for LLM consumption
 */
export function formatQueryResults(results: any[]): string {
  if (results.length === 0) {
    return 'No SailPoint queries were executed.';
  }
  
  let formatted = '\n=== SAILPOINT QUERY RESULTS ===\n\n';
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    formatted += `Query ${i + 1}:\n`;
    
    if (result.error) {
      formatted += `ERROR: ${result.error}\n\n`;
      continue;
    }
    
    if (result.type === 'count') {
      formatted += `Total Count: ${result.count}\n`;
      formatted += `Resource Type: ${result.resource}\n\n`;
    } else if (result.data) {
      const dataArray = Array.isArray(result.data) ? result.data : [result.data];
      formatted += `Resource Type: ${result.type}\n`;
      formatted += `Items Returned: ${dataArray.length}\n`;
      
      // Pagination info
      if (result.totalCount !== undefined) {
        formatted += `Total Available: ${result.totalCount}\n`;
        formatted += `Current Offset: ${result.offset || 0}\n`;
        formatted += `Limit: ${result.limit || 250}\n`;
        formatted += `Has More Pages: ${result.hasMore ? 'YES' : 'NO'}\n`;
        
        if (result.hasMore) {
          const nextOffset = (result.offset || 0) + dataArray.length;
          formatted += `\n⚠️  MORE DATA AVAILABLE!\n`;
          formatted += `To get next page, use: offset=${nextOffset}, limit=${result.limit || 250}\n`;
          formatted += `Remaining items: ${result.totalCount - nextOffset}\n`;
        }
      }
      
      // Provide complete JSON for analysis
      // Intelligently limit based on total size to avoid token overflow
      const maxTokenEstimate = 10000; // Rough character limit for results
      const itemsToShow = Math.min(dataArray.length, 25); // Reduced from 50 to 25
      const sample = dataArray.slice(0, itemsToShow);
      
      // For large datasets, provide aggregated summaries instead of full JSON
      if (dataArray.length > 100) {
        formatted += `\n⚠️  LARGE DATASET DETECTED (${dataArray.length} items)\n`;
        formatted += `Providing aggregated summary instead of full JSON to avoid token limits.\n\n`;
        
        // Auto-aggregate by source if available
        const sourceBreakdown: Record<string, number> = {};
        const ownerBreakdown: Record<string, number> = {};
        
        dataArray.forEach((item: any) => {
          const sourceName = item.source?.name || 'Unknown Source';
          const ownerName = item.owner?.name || 'Unknown Owner';
          sourceBreakdown[sourceName] = (sourceBreakdown[sourceName] || 0) + 1;
          ownerBreakdown[ownerName] = (ownerBreakdown[ownerName] || 0) + 1;
        });
        
        formatted += `BREAKDOWN BY SOURCE:\n`;
        Object.entries(sourceBreakdown)
          .sort(([,a], [,b]) => b - a)
          .forEach(([source, count]) => {
            formatted += `  - ${source}: ${count} items\n`;
          });
        
        formatted += `\nSample of first ${itemsToShow} items:\n`;
        formatted += JSON.stringify(sample, null, 2);
      } else {
        // Small dataset - show full JSON
        formatted += `\nFull JSON Data (showing ${itemsToShow} of ${dataArray.length} items):\n`;
        formatted += JSON.stringify(sample, null, 2);
      }
      
      if (dataArray.length > itemsToShow) {
        formatted += `\n\n... ${dataArray.length - itemsToShow} more items not shown in this response\n`;
        formatted += `Total items in this page: ${dataArray.length}\n`;
      }
      
      // Add hints about common fields to analyze
      if (dataArray.length > 0 && result.type === 'roles') {
        formatted += `\n\nKEY FIELDS TO ANALYZE:\n`;
        formatted += `- Each role has a "source" object with {id, name, type}\n`;
        formatted += `- Each role has an "owner" object\n`;
        formatted += `- Each role may have "accessProfiles" array\n`;
        formatted += `- Group roles by source.name to break down by source system\n`;
      } else if (dataArray.length > 0 && result.type === 'access-profiles') {
        formatted += `\n\nKEY FIELDS TO ANALYZE:\n`;
        formatted += `- Each access profile has a "source" object with {id, name}\n`;
        formatted += `- Each has an "owner" and may have "entitlements"\n`;
        formatted += `- Group by source.name to see distribution\n`;
      }
      
      formatted += '\n';
    }
  }
  
  formatted += '\n=== END SAILPOINT RESULTS ===\n\n';
  formatted += 'INSTRUCTIONS:\n';
  formatted += '1. Analyze the complete JSON objects above\n';
  formatted += '2. Look at nested fields like source, owner, accessProfiles, etc.\n';
  formatted += '3. If asked to break down or group data, aggregate by the relevant field\n';
  formatted += '4. Check pagination info - if hasMore=true, you may need additional queries with offset\n';
  formatted += '5. For complete analysis of large datasets, fetch all pages using offset parameter\n';
  formatted += '6. Present your findings in clear, natural language\n';
  formatted += '7. Include specific counts and examples from the data\n\n';
  
  return formatted;
}
