// backend/src/services/sailpointChatIntegration.ts
// Intelligent SailPoint integration for chat - injects function calling capabilities

import { sailpointRequest, getSailpointConfig } from './sailpoint';
import { SAILPOINT_API_MAP } from './sailpoint-api-map';
import { getDB } from './storage';
import { logInfo, logError } from '../utils/logger';

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

**CRITICAL FILTER RULE - READ FIRST**:
The TRANSFORMS endpoint has LIMITED filter support:
- ONLY supports: "name eq \"exact\"" OR "name sw \"prefix\""  
- NEVER use: "name co \"text\"" - this will cause API errors
- For partial matching on transforms: ALWAYS use 'sw' (starts with) NOT 'co' (contains)
Example: "name sw \"Cornerstone\"" (correct) | "name co \"Cornerstone\"" (WRONG - will fail)

**FILTER REQUIREMENTS**:
- Different resources support different filter fields and operators
- Always use the correct field names for each resource type
- Use 'sourceId' for accounts, 'source.id' for entitlements/access-profiles
- If a query returns an error, check the filter syntax carefully

**RESOURCES THAT DO NOT SUPPORT FILTERING**:
The following resources do NOT support the 'filters' parameter and will return a 400 error if you try to use filters:
- workflows (fetch all workflows, then filter client-side by name if needed)
- triggers (fetch all, then filter client-side)
- transforms (ONLY supports: "name eq \"exact\"" OR "name sw \"prefix\"" - see note above)

For these resources, omit the 'filters' parameter entirely and retrieve all records.
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

**ACTION NAMING RULES:**
- ALWAYS use PLURAL resource names: "sources" NOT "source", "identities" NOT "identity"
- Use exact resource names from the list above (e.g., "sources" not "source_details")
- Pattern: {action}_{resource} where action is: count, search, list, or get
- Examples: "search_sources", "get_sources", "count_entitlements"
- DO NOT invent action names like "get_source_details" or use singular forms like "get_source"
- Use underscores in resource names (convert hyphens): "access_profiles" not "access-profiles"

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
When you receive a response with hasMore=true OR when user initially requests ALL items:

**DETECTING "ALL" REQUESTS:**
If the user's INITIAL request contains keywords like:
- "all entitlements"
- "every role"
- "complete list"
- "entire breakdown"
- "analyze all"
- "full analysis"
Then you should IMMEDIATELY generate ALL pagination queries WITHOUT asking for confirmation.

**FOR FIRST QUERY (when user didn't say "all"):**
1. INFORM the user about the total count
2. Tell them you retrieved the first page
3. ASK if they want you to fetch all pages
4. WAIT for user confirmation

**WHEN USER CONFIRMS "YES" or "FETCH ALL" OR INITIALLY REQUESTED "ALL":**
1. Generate MULTIPLE <sailpoint_query> tags in a SINGLE response
2. Calculate offsets intelligently (offset = page * 250)
3. Generate as MANY queries as necessary to complete the full dataset
4. For very large datasets (>10,000 items), you can generate dozens or hundreds of queries
5. All queries will execute in parallel with progress tracking shown to the user

Example - User says "analyze all roles" (12,565 total):
IMMEDIATELY generate ALL ~50 queries with offsets: 0, 250, 500, 750, 1000... up to 12,500
<sailpoint_query>{"action":"search_entitlements","limit":250,"offset":0,"description":"Page 1 of 51"}</sailpoint_query>
<sailpoint_query>{"action":"search_entitlements","limit":250,"offset":250,"description":"Page 2 of 51"}</sailpoint_query>
<sailpoint_query>{"action":"search_entitlements","limit":250,"offset":500,"description":"Page 3 of 51"}</sailpoint_query>
... (continue for all 51 pages)

**AGGREGATION QUERIES:**
When user asks for "breakdown by source" or similar:
- You will receive aggregated summaries for large datasets (>100 items)
- Use the BREAKDOWN BY SOURCE section in the results
- No need to see every individual item to provide counts

CRITICAL: If user's INITIAL request says "all", "every", "complete", or "entire", DO NOT ASK - FETCH EVERYTHING IMMEDIATELY!
When user confirms later, generate ALL pagination queries in ONE response for efficiency.

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
- connectorAttributes: {configuration details including connectionParameters, schemas}
- schemas: [{id, name, nativeObjectType, identityAttribute, displayAttribute, attributeDefinitions: []}] (may also be found inside connectorAttributes)
- owner: {id, name}
- healthy, status, connectionType
- accountCorrelationConfig, entitlementCorrelationConfig
**FILTERABLE FIELDS**: name, description, type, healthy, status, owner.id, owner.name
**NOT FILTERABLE**: connector, connectorAttributes (use 'name' to find connector type)
**ACCOUNT SCHEMAS**: Account schemas are NESTED in the source object, typically inside connectorAttributes.schemas or a top-level schemas array, NOT a separate resource
  - Use get_sources with the source ID to retrieve full source details including schemas
  - Each schema has: id, name, nativeObjectType, identityAttribute, displayAttribute
  - Schema attributeDefinitions array contains all account attributes with name, type, description
  - DO NOT try to use get_schemas or search_schemas - schemas are part of sources
Use for: System inventories, connector health, integration analysis, account schema inspection

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
**CRITICAL**: Transforms endpoint ONLY supports 'eq' and 'sw' operators for name field
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
- Get by ID (includes schemas): <sailpoint_query>{"action":"get_sources","id":"2c9180867...","description":"Getting specific source with account schemas"}</sailpoint_query>
- Get by name: <sailpoint_query>{"action":"search_sources","filters":"name eq \"Active Directory\"","limit":1,"description":"Finding source by name"}</sailpoint_query>
- To find by connector type, use name (contains connector type): <sailpoint_query>{"action":"search_sources","filters":"name co \"JDBC\"","description":"Finding JDBC sources"}</sailpoint_query>
- To get account schemas, use get_sources with ID - schemas are nested in source object, NOT a separate resource

**Access Requests:**
- Recent: <sailpoint_query>{"action":"search_access-requests","limit":50,"description":"Getting recent access requests"}</sailpoint_query>

**Work Items:**
- Pending: <sailpoint_query>{"action":"search_work-items","filters":"state eq \\"PENDING\\"","description":"Finding pending work items"}</sailpoint_query>

**Certifications:**
- Active: <sailpoint_query>{"action":"search_certifications","filters":"phase eq \\"ACTIVE\\"","description":"Finding active certifications"}</sailpoint_query>

**Transforms:**
- **CRITICAL - READ THIS**: Transforms ONLY support 'eq' and 'sw' operators (NOT 'co')
- Count: <sailpoint_query>{"action":"count_transforms","description":"Getting transform count"}</sailpoint_query>
- Search by prefix: <sailpoint_query>{"action":"search_transforms","filters":"name sw \\"Cornerstone\\"","description":"Finding transforms starting with Cornerstone"}</sailpoint_query>
- Exact match: <sailpoint_query>{"action":"search_transforms","filters":"name eq \\"Transform Name\\"","description":"Finding specific transform"}</sailpoint_query>
- NEVER USE: "name co \"text\"" - This will FAIL on transforms endpoint!

**SOD Violations:**
- Active: <sailpoint_query>{"action":"search_sod-violations","filters":"state eq \\"ACTIVE\\"","description":"Finding active SOD violations"}</sailpoint_query>

ANALYZING BREAKDOWNS:
When asked to "break down by source" or similar:
1. Request the full data set with search_{resource}
2. You'll receive complete JSON objects
3. Group by the requested field (e.g., source.name, owner.name)
4. Present results in natural language with counts per group

SCIM FILTER EXAMPLES:
IMPORTANT: Different endpoints support different filter operators!

**TRANSFORMS ENDPOINT - SPECIAL RULES**:
- NEVER USE: "name co \"text\"" - API will reject with "Match mode not supported" error
- ALWAYS USE: "name sw \"text\"" (starts with) for partial matching
- OR USE: "name eq \"exact name\"" for exact matching

Example correct transforms queries:
- name sw "Cornerstone" (finds: Cornerstone-*, Cornerstonexyz, etc.)
- name eq "Cornerstone-Transform-1" (exact match only)
- name co "Cornerstone" WILL FAIL!

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

**CRITICAL PAGINATION REMINDERS:**
1. If user says "all", "every", "complete", "entire" → Generate ALL pagination queries IMMEDIATELY
2. When you get hasMore=true in results AND user already said "all" → Generate remaining pages NOW
3. Calculate total pages: Math.ceil(totalCount / 250)
4. Generate ALL queries with offsets: 0, 250, 500, 750, etc. up to (totalPages-1)*250
5. For 12,565 items = 51 pages → Generate 51 queries in ONE response
6. The system handles parallel execution and shows progress to the user
7. DO NOT ask for permission if user's original request said "all"

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
        // Resources that do NOT support filtering - strip filters to prevent 400 errors
        const noFilterResources = ['workflows', 'triggers'];
        let filters = rawFilters;
        
        if (filters && noFilterResources.includes(resource)) {
          logInfo(`[SAILPOINT_CHAT] WARNING: ${resource} does not support filtering. Ignoring filters for count query.`);
          logInfo(`[SAILPOINT_CHAT] Original filter was: ${filters}`);
          filters = undefined; // Strip the filter
        }
        
        if (filters) {
          logInfo(`[SAILPOINT_CHAT] Count query with filter: ${filters}`);
        }
        
        // For filtered counts on accounts/entitlements/access-profiles, use direct endpoint with filters
        // The Search API doesn't have an 'accounts' index (only 'accountactivities' which is for audit logs)
        // The /v2025/accounts, /v2025/entitlements, and /v2025/access-profiles endpoints DO support filtering
        if (filters && (resource === 'accounts' || resource === 'entitlements' || resource === 'access-profiles')) {
          // Use direct endpoint - v2025 supports filtering on these resources
          let path = `${basePath}?count=true&limit=1&filters=${encodeURIComponent(filters)}`;
          
          logInfo(`[SAILPOINT_CHAT] API call: GET ${path}`);
          const result: any = await sailpointRequest(config, path, 'GET', undefined, {}, false, true);
          const count = parseInt(result.headers?.['x-total-count'] || '0', 10);
          logInfo(`[SAILPOINT_CHAT] ${resource} count from header (filtered): ${count}`);
          return { count, type: 'count', resource };
        }
        
        // For other resources with filters, try Search API
        if (filters) {
          logInfo(`[SAILPOINT_CHAT] Using Search API for filtered count of ${resource}`);
          const { executeSearchCount } = await import('./sailpoint-search');
          try {
            const count = await executeSearchCount(config, resource, filters);
            logInfo(`[SAILPOINT_CHAT] ${resource} count from Search API (filtered): ${count}`);
            return { count, type: 'count', resource };
          } catch (error: any) {
            logError(`[SAILPOINT_CHAT] Search API count failed, will try direct endpoint:`, error);
            // Fall through to try direct endpoint as fallback
          }
        }
        
        // For unfiltered counts, use the fast header-only approach
        let path = `${basePath}?count=true&limit=1`;
        
        logInfo(`[SAILPOINT_CHAT] API call: GET ${path}`);
        const result: any = await sailpointRequest(config, path, 'GET', undefined, {}, false, true);
        const count = parseInt(result.headers?.['x-total-count'] || '0', 10);
        logInfo(`[SAILPOINT_CHAT] ${resource} count from header: ${count}`);
        
        return { count, type: 'count', resource };
      }
    }
    
    // Pattern: search_{resource} OR list_{resource} (both are equivalent)
    const searchMatch = action.match(/^(search|list)_(.+)$/);
    if (searchMatch) {
      const resource = searchMatch[2].replace(/_/g, '-');
      let path = `/${resource}?limit=${limit}`;
      if (offset > 0) path += `&offset=${offset}`;
      
      // Resources that do NOT support filtering - strip filters to prevent 400 errors
      const noFilterResources = ['workflows', 'triggers'];
      let filters = rawFilters;
      
      if (filters && noFilterResources.includes(resource)) {
        logInfo(`[SAILPOINT_CHAT] WARNING: ${resource} does not support filtering. Ignoring filters and fetching all records.`);
        logInfo(`[SAILPOINT_CHAT] Original filter was: ${filters}`);
        filters = undefined; // Strip the filter
      }
      
      if (filters) {
        path += `&filters=${encodeURIComponent(filters)}`;
      }
      
      logInfo(`[SAILPOINT_CHAT] API call: GET ${path}`);
      
      // Get both data and total count for pagination awareness
      const result: any = await sailpointRequest(config, `${path.includes('?') ? path + '&' : path + '?'}count=true`, 'GET', undefined, {}, false, true);
      const data = result.data;
      const totalCount = parseInt(result.headers?.['x-total-count'] || '0', 10);
      const returnedCount = Array.isArray(data) ? data.length : 0;
      
      logInfo(`[SAILPOINT_CHAT] Retrieved ${returnedCount} ${resource} (total available: ${totalCount}, offset: ${offset})`);
      
      // FALLBACK: If filters were used but returned 0 results, try v3 search API
      if (filters && returnedCount === 0 && offset === 0) {
        logInfo(`[SAILPOINT_CHAT] Filter returned 0 results, attempting v3 search fallback`);
        try {
          const { executeSearchQuery } = await import('./sailpoint-search');
          const v3Results = await executeSearchQuery(config, resource, filters, limit, offset, true);
          
          if (Array.isArray(v3Results) && v3Results.length > 0) {
            logInfo(`[SAILPOINT_CHAT] V3 search fallback successful: ${v3Results.length} results`);
            return {
              data: v3Results,
              type: resource,
              count: v3Results.length,
              totalCount: v3Results.length,
              offset,
              limit,
              hasMore: false,
              usedV3Fallback: true,
              fallbackReason: 'Standard filters returned 0 results'
            };
          }
        } catch (v3Error: any) {
          logError(`[SAILPOINT_CHAT] V3 search fallback failed:`, v3Error);
          // Continue with original empty result
        }
      }
      
      const response: any = { 
        data, 
        type: resource, 
        count: returnedCount,
        totalCount,
        offset,
        limit,
        hasMore: (offset + returnedCount) < totalCount
      };
      
      return response;
    }
    
    // EXPLICIT REJECTION: Detect common singular form mistakes
    const singularForms = ['get_source', 'get_schema', 'get_role', 'get_identity', 'get_account', 
                           'get_entitlement', 'get_workflow', 'get_transform', 'get_connector',
                           'search_source', 'search_schema', 'search_role', 'search_identity',
                           'count_source', 'count_schema', 'count_role', 'count_identity'];
    
    if (singularForms.includes(action)) {
      const pluralForm = `${action}s`;
      throw new Error(
        `INVALID ACTION: "${action}" is using SINGULAR form.\n` +
        `CORRECT ACTION: "${pluralForm}" (use PLURAL form)\n\n` +
        `REMINDER: ALL resource names MUST be plural:\n` +
        `- sources (not source)\n` +
        `- schemas (not schema) - NOTE: schemas are nested in sources, use get_sources with source ID\n` +
        `- roles (not role)\n` +
        `- identities (not identity)\n` +
        `- accounts (not account)\n\n` +
        (id ? `You provided id="${id}", use: {"action":"${pluralForm}","id":"${id}"}` : 
               `If you have an ID, use: {"action":"${pluralForm}","id":"your-id-here"}`)
      );
    }
    
    // Pattern: get_{resource} (requires id)
    const getMatch = action.match(/^get_(.+)$/);
    if (getMatch) {
      const resourceName = getMatch[1];
      
      if (!id) {
        // Check if they used singular form (e.g., get_source instead of get_sources)
        const pluralForm = resourceName.endsWith('s') ? resourceName : `${resourceName}s`;
        throw new Error(
          `get_${resourceName} requires an 'id' parameter.\n` +
          `Options:\n` +
          `1. Use search_${pluralForm} with filters to find the resource first\n` +
          `2. Provide an id parameter if you know the specific ID\n` +
          `Note: Action names should be plural (e.g., 'get_sources' not 'get_source')`
        );
      }
      
      const resource = getMatch[1].replace(/_/g, '-');
      const path = `/${resource}/${id}`;
      
      logInfo(`[SAILPOINT_CHAT] API call: GET ${path}`);
      const data = await sailpointRequest(config, path, 'GET');
      logInfo(`[SAILPOINT_CHAT] Retrieved ${resource} with id: ${id}`);
      return { data, type: resource, id };
    }
    
    // Fallback for unmatched actions - provide helpful suggestions
    const actionParts = action.split('_');
    const verb = actionParts[0]; // count, search, get, list
    const resourcePart = actionParts.slice(1).join('_');
    
    let suggestion = '';
    if (verb === 'get' && resourcePart) {
      suggestion = ` Did you mean 'get_${resourcePart.replace(/[-_]details?$/, '')}' with an id parameter, or 'search_${resourcePart.replace(/[-_]details?$/, '')}' with filters?`;
    } else if (verb === 'search' || verb === 'list' || verb === 'count') {
      suggestion = ` Check that the resource name is correct (use underscores, not hyphens).`;
    }
    
    throw new Error(`Unsupported action: ${action}. Use count_{resource}, list_{resource}, search_{resource}, or get_{resource} (with id parameter).${suggestion}`);
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
          formatted += `\n MORE DATA AVAILABLE!\n`;
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
        formatted += `\nLARGE DATASET DETECTED (${dataArray.length} items)\n`;
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
      } else if (dataArray.length > 0 && result.type === 'sources') {
        formatted += `\n\nKEY FIELDS TO ANALYZE:\n`;
        formatted += `- Each source has "connectorAttributes" with full configuration including connectionParameters\n`;
        formatted += `- Account schemas are in "schemas" array with attributeDefinitions, or inside connectorAttributes.schemas\n`;
        formatted += `- Look for nested objects - connectorAttributes can be VERY deep\n`;
        formatted += `- For JDBC/Web Services sources, check connectorAttributes.connectionParameters for HTTP operations\n`;
        formatted += `- All nested data is fully preserved in the JSON above\n`;
      }
      
      formatted += '\n';
    }
  }
  
  formatted += '\n=== END SAILPOINT RESULTS ===\n\n';
  formatted += 'INSTRUCTIONS:\n';
  formatted += '1. Analyze the complete JSON objects above - ALL nested data is preserved\n';
  formatted += '2. Look at nested fields like source, owner, accessProfiles, connectorAttributes, schemas, etc.\n';
  formatted += '3. For sources: Check connectorAttributes.connectionParameters for deep configuration\n';
  formatted += '4. For sources: Account schemas are in the "schemas" array with full attributeDefinitions\n';
  formatted += '5. If asked to break down or group data, aggregate by the relevant field\n';
  formatted += '6. Check pagination info - if hasMore=true, you may need additional queries with offset\n';
  formatted += '7. For complete analysis of large datasets, fetch all pages using offset parameter\n';
  formatted += '8. Present your findings in clear, natural language\n';
  formatted += '9. Include specific counts and examples from the data\n';
  formatted += '10. DEEP NESTED OBJECTS ARE FULLY AVAILABLE - traverse arrays and objects to find what you need\n\n';
  
  return formatted;
}
