// backend/src/services/sailpointQueryOrchestrator.ts
// Intelligent orchestration of SailPoint queries with iterative refinement and progress tracking

import { anythingllmRequest } from './anythingllm';
import { executeSailPointQuery } from './sailpointChatIntegration';
import { sailpointRequest, getSailpointConfig } from './sailpoint';
import { logInfo, logError } from '../utils/logger';

interface SailPointContext {
  customerId: number;
  customerName: string;
  environment: 'sandbox' | 'prod';
}

interface QueryStep {
  stepNumber: number;
  description: string;
  query: any;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

interface QueryPlan {
  userIntent: string;
  strategy: string;
  requiredFields?: string[]; // Fields needed to answer the user's question
  requiresPagination: boolean;
  estimatedSteps: number;
  steps: QueryStep[];
}

interface ProgressUpdate {
  type: 'plan_created' | 'step_started' | 'step_completed' | 'step_failed' | 'step_progress' | 'all_completed';
  stepNumber?: number;
  totalSteps?: number;
  description?: string;
  data?: any;
}

/**
 * Filter an object to only include specified fields
 */
function filterToRequiredFields(obj: any, requiredFields: string[]): any {
  if (!requiredFields || requiredFields.length === 0) {
    return obj; // No filtering needed
  }
  
  const filtered: any = {};
  
  for (const field of requiredFields) {
    // Support nested fields with dot notation (e.g., "source.name")
    if (field.includes('.')) {
      const parts = field.split('.');
      let value = obj;
      for (const part of parts) {
        value = value?.[part];
      }
      // Set nested value
      let current = filtered;
      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = current[parts[i]] || {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    } else if (obj.hasOwnProperty(field)) {
      filtered[field] = obj[field];
    }
  }
  
  return filtered;
}

/**
 * Recursively discover all available field paths in an object
 * Returns flat list like: ["id", "name", "attributes", "attributes.values", "source.name"]
 */
function discoverAllFieldPaths(obj: any, prefix: string = '', maxDepth: number = 10, currentDepth: number = 0): string[] {
  if (!obj || typeof obj !== 'object' || currentDepth >= maxDepth) {
    return [];
  }
  
  const fields: string[] = [];
  
  for (const key of Object.keys(obj)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    fields.push(fieldPath);
    
    // Recursively explore nested objects (but not arrays)
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nestedFields = discoverAllFieldPaths(value, fieldPath, maxDepth, currentDepth + 1);
      fields.push(...nestedFields);
    }
  }
  
  return fields;
}

/**
 * Properly pluralize SailPoint resource types
 * Handles irregular plurals like identity->identities, policy->policies
 */
function pluralizeResource(resourceType: string): string {
  // Irregular plurals map (resources that don't follow standard rules)
  const irregularPlurals: Record<string, string> = {
    'identity': 'identities',
    'policy': 'policies',
    'activity': 'activities',
    'strategy': 'strategies',
    'history': 'histories',
    'dictionary': 'dictionaries',
  };
  
  if (irregularPlurals[resourceType]) {
    return irregularPlurals[resourceType];
  }
  
  // Handle compound words with hyphens (e.g., "access-profile" -> "access-profiles")
  if (resourceType.includes('-')) {
    const parts = resourceType.split('-');
    const lastPart = parts[parts.length - 1];
    const pluralLast = pluralizeResource(lastPart); // Recursively pluralize last part
    parts[parts.length - 1] = pluralLast;
    return parts.join('-');
  }
  
  // Regular pluralization rules
  if (resourceType.endsWith('y') && !['ay', 'ey', 'iy', 'oy', 'uy'].some(v => resourceType.endsWith(v))) {
    // policy -> policies, identity -> identities (but not array, key, etc.)
    return resourceType.slice(0, -1) + 'ies';
  }
  
  if (resourceType.endsWith('s') || resourceType.endsWith('sh') || resourceType.endsWith('ch') || resourceType.endsWith('x')) {
    // access -> accesses (though we don't have this case in SailPoint)
    return resourceType + 'es';
  }
  
  // Default: just add 's'
  return resourceType + 's';
}

/**
 * Detect if a field value is a reference to another SailPoint resource
 * Returns the resource type and identifier if it's a reference, null otherwise
 */
function detectReference(fieldName: string, fieldValue: any): { resourceType: string, identifier: string } | null {
  if (!fieldValue) return null;
  
  // IMPORTANT: Skip already-expanded fields to prevent infinite loops
  if (fieldName.endsWith('_expanded')) return null;
  
  // Pattern 1: Field ending with "Id" and value is a GUID-like string
  if (fieldName.endsWith('Id') && typeof fieldValue === 'string' && fieldValue.match(/^[a-f0-9-]{20,}$/i)) {
    // Remove "Id" suffix to get resource type (e.g., "sourceId" -> "source")
    const resourceType = fieldName.replace(/Id$/, '');
    return { resourceType, identifier: fieldValue };
  }
  
  // Pattern 2: Field ending with "Name" containing a string value
  if (fieldName.endsWith('Name') && typeof fieldValue === 'string') {
    // Remove "Name" suffix to get resource type (e.g., "sourceName" -> "source")
    const resourceType = fieldName.replace(/Name$/, '');
    return { resourceType, identifier: fieldValue };
  }
  
  // Pattern 3: Nested object with "id" and "type" fields (SailPoint reference object)
  if (fieldValue && typeof fieldValue === 'object' && fieldValue.id && fieldValue.type) {
    return { resourceType: fieldValue.type.toLowerCase(), identifier: fieldValue.id };
  }
  
  // Pattern 4: Known reference fields (owner, source, etc.)
  const knownReferenceFields = ['owner', 'source', 'account', 'identity', 'role', 'entitlement'];
  if (knownReferenceFields.includes(fieldName.toLowerCase()) && typeof fieldValue === 'object' && fieldValue.id) {
    return { resourceType: fieldName.toLowerCase(), identifier: fieldValue.id };
  }
  
  return null;
}

/**
 * Expand references in data by fetching related objects
 * This selectively expands important reference fields while avoiding infinite loops
 */
async function expandReferences(
  data: any[],
  context: SailPointContext,
  maxDepth: number = 1, // Reduced default depth to 1 to prevent deep recursion
  currentDepth: number = 0,
  expandedCache: Set<string> = new Set() // Track what we've already expanded
): Promise<any[]> {
  if (!data || data.length === 0 || currentDepth >= maxDepth) {
    return data;
  }
  
  // logInfo(`[REFERENCE EXPANSION] Depth ${currentDepth}: Analyzing ${data.length} items for references`);
  
  // Define which fields are worth expanding (whitelist approach)
  // This prevents expanding everything and causing loops
  const EXPANDABLE_FIELDS = new Set([
    'source', 'sourceId', 'sourceName',
    'owner', 'ownerId', 'ownerName', 
    'identity', 'identityId', 'identityName',
    'account', 'accountId',
    'role', 'roleId', 'roleName',
    'accessProfile', 'accessProfileId', 'accessProfileName',
    'application', 'applicationId', 'applicationName'
  ]);
  
  const expandedData = [];
  let requestCount = 0;
  
  for (const item of data) {
    const expandedItem = { ...item };
    
    // Find all reference fields in this item
    for (const [fieldName, fieldValue] of Object.entries(item)) {
      // CRITICAL: Only expand whitelisted fields to prevent runaway expansion
      if (!EXPANDABLE_FIELDS.has(fieldName)) {
        continue;
      }
      
      const reference = detectReference(fieldName, fieldValue);
      
      if (reference) {
        // Create a unique cache key to prevent re-expanding the same reference
        const cacheKey = `${reference.resourceType}:${reference.identifier}`;
        
        if (expandedCache.has(cacheKey)) {
          // logInfo(`[REFERENCE EXPANSION] Skipping ${fieldName}: Already expanded ${cacheKey}`);
          continue;
        }
        
        // logInfo(`[REFERENCE EXPANSION] Found reference: ${fieldName} -> ${reference.resourceType} (${reference.identifier})`);
        
        try {
          // Get SailPoint config to make direct API calls (avoid recursive expansion)
          const config = await getSailpointConfig(context.customerId, context.environment);
          if (!config) {
            // logInfo(`[REFERENCE EXPANSION] Skipping ${fieldName}: No SailPoint config`);
            continue;
          }
          
          // Mark this reference as being expanded
          expandedCache.add(cacheKey);
          requestCount++;
          
          // Determine the API endpoint with proper pluralization
          const pluralResourceType = pluralizeResource(reference.resourceType);
          
          // Fetch the referenced object directly from SailPoint API (no orchestrator, no expansion)
          // The sailpointRequest function will handle 429 rate limits with exponential backoff
          let referencedObject = null;
          
          // If we have an ID, fetch by ID (more efficient)
          if (fieldName.endsWith('Id')) {
            const endpoint = `/${pluralResourceType}/${reference.identifier}`;
            
            try {
              const apiResult = await sailpointRequest(config, endpoint, 'GET');
              if (apiResult) {
                referencedObject = apiResult;
              }
            } catch (getError: any) {
              // logInfo(`[REFERENCE EXPANSION] get by ID failed: ${getError.message}`);
            }
          }
          
          // If get failed or we have a name, try search
          if (!referencedObject) {
            const filterParam = fieldName.endsWith('Name') 
              ? `name eq "${reference.identifier}"`
              : `id eq "${reference.identifier}"`;
            const endpoint = `/${pluralResourceType}?limit=1&filters=${encodeURIComponent(filterParam)}`;
            
            try {
              const apiResult = await sailpointRequest(config, endpoint, 'GET');
              if (apiResult && Array.isArray(apiResult) && apiResult.length > 0) {
                referencedObject = apiResult[0];
              }
            } catch (searchError: any) {
              // logInfo(`[REFERENCE EXPANSION] search failed: ${searchError.message}`);
            }
          }
          
          if (referencedObject) {
            // logInfo(`[REFERENCE EXPANSION] Expanded ${fieldName}: fetched ${reference.resourceType}`);
            
            // Keep both the original reference AND the expanded object
            expandedItem[fieldName] = fieldValue; // Keep original
            expandedItem[`${fieldName}_expanded`] = referencedObject; // Add expanded version
          }
        } catch (expansionError: any) {
          // logInfo(`[REFERENCE EXPANSION] Failed to expand ${fieldName}: ${expansionError.message}`);
          // Keep original reference if expansion fails
        }
      }
    }
    
    expandedData.push(expandedItem);
  }
  
  // logInfo(`[REFERENCE EXPANSION] Depth ${currentDepth}: Expanded ${expandedData.length} items (${requestCount} API requests)`);
  
  // Don't recursively expand nested objects - only expand one level deep
  // This prevents infinite loops and keeps the response size manageable
  return expandedData;
}

/**
 * Intelligently analyze the discovered schema and select the most useful fields
 * This looks at the actual data structure to determine what's important
 */
function selectIntelligentFields(schema: any, allFieldPaths: string[]): string[] {
  const selectedFields: string[] = [];
  
  // ALWAYS include these common identifier/metadata fields if they exist
  const alwaysInclude = ['id', 'name', 'type', 'description', 'created', 'modified'];
  for (const field of alwaysInclude) {
    if (schema.hasOwnProperty(field)) {
      selectedFields.push(field);
    }
  }
  
  // Analyze top-level fields for importance
  for (const [key, value] of Object.entries(schema)) {
    if (alwaysInclude.includes(key)) continue; // Already added
    
    // Include objects that contain configuration or logic (like 'attributes')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nestedKeys = Object.keys(value);
      
      // If the object has interesting nested structure, include it AND important nested paths
      const hasInterestingStructure = nestedKeys.some(k => 
        ['value', 'values', 'table', 'input', 'output', 'logic', 'config', 'operation', 'type', 'expression'].includes(k)
      );
      
      if (hasInterestingStructure) {
        selectedFields.push(key); // Include the parent
        
        // Include important nested fields
        const nestedPaths = allFieldPaths.filter(p => p.startsWith(`${key}.`));
        selectedFields.push(...nestedPaths);
      } else if (nestedKeys.length > 0 && nestedKeys.length <= 5) {
        // Small objects - include the whole thing
        selectedFields.push(key);
        const nestedPaths = allFieldPaths.filter(p => p.startsWith(`${key}.`));
        selectedFields.push(...nestedPaths);
      } else {
        // Just include the top-level field for large/simple objects
        selectedFields.push(key);
      }
    } 
    // Include simple scalar fields (strings, numbers, booleans)
    else if (typeof value !== 'object' || value === null) {
      selectedFields.push(key);
    }
    // Include arrays if they're not huge
    else if (Array.isArray(value) && value.length <= 20) {
      selectedFields.push(key);
    }
  }
  
  return selectedFields;
}

/**
 * Analyze user query and create an intelligent execution plan
 */
export async function analyzeAndPlanQuery(
  userMessage: string,
  conversationContext: string,
  workspaceSlug: string
): Promise<QueryPlan> {
  logInfo(`[ORCHESTRATOR] Analyzing query: "${userMessage}"`);

  const analysisPrompt = `You are a SailPoint query strategist. Analyze the user's request and create a step-by-step execution plan.

User Request: "${userMessage}"

${conversationContext ? `Recent Context:\n${conversationContext}\n` : ''}

Your task:
1. Understand what the user is asking for
2. Determine if this requires multiple steps or iterations
3. Create a logical query plan

**CRITICAL RULES:**

1. **NEVER use get_resource without a previous search_resource step**
   - You CANNOT guess or make up resource IDs
   - ALWAYS search first to get valid IDs
   - Then use those IDs in subsequent get queries

2. **Discovery-First Approach**
   - For detailed information needs, start with a discovery step (limit: 1)
   - Use discovery to understand available fields
   - Then query with appropriate fields

3. **Filter Limitations**
   - transforms: ONLY supports eq and sw (NOT co)
   - identities: supports eq, sw, co
   - Use sw for prefix matching, eq for exact matching

Respond with a JSON plan following this structure:
{
  "userIntent": "brief description of what user wants",
  "strategy": "explanation of how to get this data",
  "requiredFields": ["field1", "field2", "field3"], // Fields needed to answer the question
  "requiresPagination": true/false,
  "estimatedSteps": number,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Human-readable description of this step",
      "query": {
        "action": "count_xxx or search_xxx",
        "filters": "optional SCIM filter",
        "limit": 250,
        "offset": 0,
        "description": "what this query does"
      }
    }
  ]
}

EXAMPLES:

User: "Show me details about the approval limit transforms"
{
  "userIntent": "Get detailed configuration of approval limit transforms",
  "strategy": "First search for transforms with 'approval' and 'limit' in name to get valid IDs and schema, then query for full details",
  "requiredFields": ["id", "name", "type", "attributes"],
  "requiresPagination": false,
  "estimatedSteps": 2,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Discover schema and find approval limit transforms",
      "query": {"action": "search_transforms", "filters": "name sw \\"approval\\" and name sw \\"limit\\"", "limit": 50, "description": "Finding approval limit transforms"}
    },
    {
      "stepNumber": 2,
      "description": "Get full details with attributes for discovered transforms",
      "query": {"action": "search_transforms", "filters": "name sw \\"approval\\"", "limit": 50, "description": "Getting full transform configurations"}
    }
  ]
}

User: "How many identities do we have?"
{
  "userIntent": "Get total count of identities",
  "strategy": "Single count query",
  "requiredFields": [],
  "requiresPagination": false,
  "estimatedSteps": 1,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Count total identities",
      "query": {"action": "count_identities", "description": "Getting total identity count"}
    }
  ]
}

User: "Show me all accounts with their managers"
{
  "userIntent": "List accounts with manager information",
  "strategy": "First fetch a sample account to understand the schema, then identify manager field and query all accounts",
  "requiredFields": ["id", "name", "nativeIdentity", "source", "managerDn", "managerName", "status"],
  "requiresPagination": true,
  "estimatedSteps": 2,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Fetch one account to discover available fields and locate manager information",
      "query": {"action": "search_accounts", "limit": 1, "offset": 0, "description": "Schema discovery"}
    },
    {
      "stepNumber": 2,
      "description": "Fetch all accounts focusing on account and manager fields",
      "query": {"action": "search_accounts", "limit": 250, "offset": 0, "description": "Getting accounts"}
    }
  ]
}

User: "List all sources with their account counts"
{
  "userIntent": "Get all sources and count accounts per source",
  "requiredFields": ["id", "name", "type", "connector"],
  "strategy": "First fetch all sources, then count accounts for each source",
  "requiresPagination": false,
  "estimatedSteps": 2,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Get list of all sources",
      "query": {"action": "search_sources", "limit": 250, "offset": 0, "description": "Fetching all sources"}
    },
    {
      "stepNumber": 2,
      "description": "Count accounts for each source (will be done per source found)",
      "query": {"action": "count_accounts", "description": "Counting accounts per source - filter will be applied dynamically"}
    }
  ]
}

CRITICAL: For counting queries, you MUST use count_{resource} action, NOT search_{resource}!
- CORRECT: {"action": "count_accounts", "description": "Count accounts for source"}
- WRONG: {"action": "search_accounts", "limit": 1, "description": "Get account count"}
- WRONG: {"action": "search_accounts", "description": "Count accounts"}

The count_{resource} action is optimized for counting and will handle pagination automatically.

User: "Show me sources and their entitlements"
{
  "userIntent": "Get sources and their associated entitlements",
  "strategy": "Fetch sources first, then query entitlements for each source",
  "requiresPagination": true,
  "estimatedSteps": 2,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Get all sources",
      "query": {"action": "search_sources", "limit": 250, "offset": 0, "description": "Fetching sources"}
    },
    {
      "stepNumber": 2,
      "description": "Get entitlements per source",
      "query": {"action": "search_entitlements", "description": "Fetching entitlements - filter by source"}
    }
  ]
}

User: "Give me a breakdown of all roles by source"
{
  "userIntent": "Aggregate all roles grouped by source system",
  "strategy": "First get count to determine pagination needs, then fetch all roles if user confirms",
  "requiresPagination": true,
  "estimatedSteps": 1,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Fetch first page of roles to see total count",
      "query": {"action": "search_roles", "limit": 250, "offset": 0, "description": "Getting initial role data"}
    }
  ]
}

User: "Yes fetch all" (after previous response showed 750 total)
{
  "userIntent": "Fetch all remaining pages of previous query",
  "strategy": "Generate pagination queries for remaining data",
  "requiresPagination": true,
  "estimatedSteps": 2,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Fetch roles page 2 (offset 250)",
      "query": {"action": "search_roles", "limit": 250, "offset": 250, "description": "Page 2/3"}
    },
    {
      "stepNumber": 2,
      "description": "Fetch roles page 3 (offset 500)",
      "query": {"action": "search_roles", "limit": 250, "offset": 500, "description": "Page 3/3"}
    }
  ]
}

User: "Show me all entitlements from Active Directory"
{
  "userIntent": "Get entitlements filtered by source",
  "strategy": "Search with SCIM filter for AD source",
  "requiresPagination": true,
  "estimatedSteps": 1,
  "steps": [
    {
      "stepNumber": 1,
      "description": "Search for Active Directory entitlements",
      "query": {
        "action": "search_entitlements",
        "filters": "source.name eq \\"Active Directory\\"",
        "limit": 250,
        "offset": 0,
        "description": "Getting AD entitlements"
      }
    }
  ]
}

IMPORTANT RULES:
- ALWAYS use discovery to dynamically determine available fields - DO NOT hardcode field assumptions
- For ALL queries about SailPoint resources (transforms, sources, accounts, identities, entitlements, etc.):
  * Step 1: Discovery query (limit: 1, description MUST include "Discover") to fetch 1 sample item
  * Step 2+: Analyze the user's question + discovered schema to intelligently determine requiredFields
  * This ensures we work with actual available fields, not assumptions
- For "how many" questions → use count_xxx action, no discovery needed, requiredFields: []

CRITICAL - COUNT QUERIES:
- **NEVER fetch all items to count them!** Use count_xxx actions instead!
- For "count of X for each Y" or "breakdown by source":
  * Step 1: Get list of Y items (e.g., all sources) with minimal fields [id, name]
  * Step 2: Use count_xxx with dependent filter for EACH Y item
  * Example: "account counts for each source"
    → Step 1: search_sources (get all sources)
    → Step 2: count_accounts (will be executed per source with sourceId filter)
- **DO NOT** use search_xxx to fetch thousands of items and count client-side!
- **DO NOT** paginate through all data when you can use count_xxx!
- Count queries are fast and efficient - use them!

- Discovery step format:
  {
    "stepNumber": 1,
    "description": "Discover available fields from sample transform",
    "query": {
      "action": "search_transforms",
      "limit": 1,
      "description": "Discover schema"
    }
  }
- After discovery, you'll see what fields are available. Map user's question to needed fields:
  * "How does X work?" or "What does X do?" or "Explain X" → Include configuration fields (attributes, config, definition)
  * "List all X" or "Show me X" → Include identifying fields (id, name, type)
  * "Find X with Y in name" → Include just id, name
  * "X with their Y" (relationships) → Include relationship fields (source, owner, manager)
  * "Details of X" → Include most/all available fields from discovery
- For queries searching for text WITHIN/CONTAINING in names:
  * DO NOT use filters (filters only support starts-with/equals, not contains for most endpoints)
  * Fetch ALL items without filters
  * Include minimal fields needed (typically just id, name based on discovery)
  * The synthesis AI will search through the data to find matches
- For exact match queries (e.g., "source named Workday"):
  * Use filters with "eq" operator: filters: 'name eq "Workday"'
  * Still do discovery first to know what fields are available
- For getting details of a SPECIFIC item by ID:
  * Use get_{resource} action with the ID
  * Include all fields from discovery that answer the question
  * Example: "explain transform abc-123" → discovery shows {id, name, type, attributes}
    → User wants to know how it works → include "attributes" (contains the logic)
- For queries requiring data from multiple resources (e.g., "sources with account counts"):
  * Step 1: Discovery on primary resource
  * Step 2: Fetch primary resource with minimal fields
  * Step 3+: Fetch related data for each item from step 2
- If context shows a previous query with totalCount, calculate ALL remaining pages needed
- Each step should have a clear, user-friendly description
- Generate as many steps as necessary to complete the user's request
- All queries will execute in parallel for maximum efficiency
- When a step depends on results from a previous step, note it in the description
- Always prioritize minimal data extraction - only get fields needed based on discovery + user question

Respond ONLY with valid JSON, no other text.`;

  try {
    const response = await anythingllmRequest<{ textResponse?: string }>(
      `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
      "POST",
      {
        message: analysisPrompt,
        mode: 'chat',
        sessionId: 'system-query-planner'
      }
    );

    const planText = response.textResponse || '';
    
    // Extract JSON from response
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logError('[ORCHESTRATOR] Failed to extract JSON plan');
      throw new Error('Could not parse query plan');
    }

    const plan: QueryPlan = JSON.parse(jsonMatch[0]);
    
    // Validate and set initial status
    plan.steps = plan.steps.map((step, index) => ({
      ...step,
      stepNumber: index + 1,
      status: 'pending' as const
    }));

    logInfo(`[ORCHESTRATOR] Plan created: ${plan.estimatedSteps} steps for "${plan.userIntent}"`);
    
    return plan;
  } catch (error: any) {
    logError('[ORCHESTRATOR] Error creating plan:', error);
    throw error;
  }
}

/**
 * Execute a query plan with real-time progress updates
 */
export async function executeQueryPlan(
  plan: QueryPlan,
  context: SailPointContext,
  onProgress?: (update: ProgressUpdate) => void
): Promise<{
  success: boolean;
  results: any[];
  summary: string;
  discoveredSchema?: any; // Schema from discovery step
  metadata: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    totalItemsFetched: number;
  };
}> {
  logInfo(`[ORCHESTRATOR] Executing plan with ${plan.steps.length} steps`);

  const allResults: any[] = [];
  let completedSteps = 0;
  let failedSteps = 0;
  let discoveredSchema: any = null;

  // Notify plan created
  if (onProgress) {
    onProgress({
      type: 'plan_created',
      totalSteps: plan.steps.length,
      description: plan.strategy
    });
  }

  // Execute each step
  for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex++) {
    const step = plan.steps[stepIndex];
    
    try {
      // Update status to executing
      step.status = 'executing';
      
      if (onProgress) {
        onProgress({
          type: 'step_started',
          stepNumber: step.stepNumber,
          totalSteps: plan.steps.length,
          description: step.description
        });
      }

      logInfo(`[ORCHESTRATOR] Executing step ${step.stepNumber}/${plan.steps.length}: ${step.description}`);

      // Check if this is a discovery step (limit: 1 for schema exploration)
      const isDiscoveryStep = step.query.limit === 1 && step.description.toLowerCase().includes('discover');
      
      // Check if this is a dependent step (step 2+ that needs to iterate over previous results)
      const isDependentStep = stepIndex > 0 && step.description.toLowerCase().includes('per source');
      
      if (isDependentStep && stepIndex > 0) {
        // This step needs to execute for each item from the previous step
        const previousStep = plan.steps[stepIndex - 1];
        const previousResults = previousStep.result?.data || [];
        
        if (previousResults.length === 0) {
          logInfo(`[ORCHESTRATOR] No items from previous step to iterate over`);
          step.status = 'completed';
          completedSteps++;
          continue;
        }
        
        logInfo(`[ORCHESTRATOR] Step ${step.stepNumber} is dependent - will execute ${previousResults.length} queries`);
        
        // Execute query for each item from previous step
        const dependentResults: any[] = [];
        let itemIndex = 0;
        
        for (const item of previousResults) {
          itemIndex++;
          
          // Create a modified query with filter for this specific item
          const modifiedQuery = { ...step.query };
          
          // Add filter based on item (e.g., filter by source.id or source.name)
          if (item.id && step.query.action?.includes('account')) {
            modifiedQuery.filters = `source.id eq "${item.id}"`;
          } else if (item.name && step.query.action?.includes('entitlement')) {
            modifiedQuery.filters = `source.name eq "${item.name}"`;
          } else if (item.id) {
            modifiedQuery.filters = `source.id eq "${item.id}"`;
          }
          
          logInfo(`[ORCHESTRATOR] Sub-query ${itemIndex}/${previousResults.length} for ${item.name || item.id}`);
          
          try {
            // Execute the query
            const result = await executeSailPointQuery(context, modifiedQuery);
            
            if (!result.error) {
              // Apply field filtering if requiredFields are specified
              let filteredData = result.data;
              if (plan.requiredFields && plan.requiredFields.length > 0 && result.data && Array.isArray(result.data)) {
                filteredData = result.data.map((item: any) => filterToRequiredFields(item, plan.requiredFields!));
              }
              
              // REFERENCE EXPANSION for dependent queries (depth 1 only to prevent loops)
              // SKIP for count queries - they don't have expandable data
              const isCountQuery = modifiedQuery.action?.startsWith('count_');
              const isCountResult = result.type === 'count';
              
              if (filteredData && Array.isArray(filteredData) && filteredData.length > 0 && !isCountQuery && !isCountResult) {
                try {
                  filteredData = await expandReferences(filteredData, context, 1);
                  logInfo(`[ORCHESTRATOR] Expanded references in dependent query results`);
                } catch (expansionError: any) {
                  logError(`[ORCHESTRATOR] Reference expansion failed for dependent query: ${expansionError.message}`);
                  // Continue with un-expanded data
                }
              } else if (isCountQuery || isCountResult) {
                logInfo(`[ORCHESTRATOR] Skipping reference expansion for count query (dependent)`);
              }
              
              // Store result with reference to source item
              const enrichedResult = {
                sourceItem: { id: item.id, name: item.name },
                ...result,
                data: filteredData
              };
              dependentResults.push(enrichedResult);
              
              if (filteredData && Array.isArray(filteredData)) {
                allResults.push(...filteredData);
              } else if (result.type === 'count') {
                allResults.push(enrichedResult);
              }
            } else {
              logInfo(`[ORCHESTRATOR] Sub-query returned error (skipping): ${result.error}`);
            }
          } catch (subError: any) {
            // Individual item failures shouldn't break the entire orchestration
            logInfo(`[ORCHESTRATOR] Sub-query failed for ${item.name || item.id}: ${subError.message}`);
            // Continue with next item
          }
          
          // Progress update every 5 items
          if (itemIndex % 5 === 0 && onProgress) {
            onProgress({
              type: 'step_progress',
              stepNumber: step.stepNumber,
              totalSteps: plan.steps.length,
              description: `Processing ${itemIndex}/${previousResults.length} items...`
            });
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        step.result = {
          type: 'aggregated',
          data: dependentResults,
          count: dependentResults.length
        };
        step.status = 'completed';
        completedSteps++;
        
        if (onProgress) {
          onProgress({
            type: 'step_completed',
            stepNumber: step.stepNumber,
            totalSteps: plan.steps.length,
            description: `Completed: ${step.description}`,
            data: {
              itemsFetched: dependentResults.length,
              totalSoFar: allResults.length
            }
          });
        }
        
      } else {
        // Regular step execution (not dependent on previous results)
        let result: any;
        
        try {
          result = await executeSailPointQuery(context, step.query);
        } catch (queryError: any) {
          // Check if this is a 404 Not Found error
          const is404 = queryError.message?.includes('404') || queryError.message?.includes('Not Found');
          
          // Check if this is a 400 error for non-queryable fields
          const is400NonQueryable = queryError.message?.includes('400') && 
            (queryError.message?.includes('not queryable') || 
             queryError.message?.includes('Invalid filter properties'));
          
          if (is404) {
            // 404 errors might mean the resource doesn't exist, which isn't always fatal
            logInfo(`[ORCHESTRATOR] Resource not found (404): ${step.description}`);
            
            // Return empty result instead of failing
            result = {
              data: [],
              count: 0,
              totalCount: 0,
              type: 'not_found',
              error: queryError.message
            };
            
            if (onProgress) {
              onProgress({
                type: 'step_progress',
                stepNumber: step.stepNumber,
                totalSteps: plan.steps.length,
                description: `Resource not found - continuing with empty result`,
                data: {
                  warning: 'The requested resource does not exist'
                }
              });
            }
          } else if (is400NonQueryable) {
            // Extract the field name from the error message
            const fieldMatch = queryError.message.match(/\[([^\]]+)\]/);
            const fieldName = fieldMatch ? fieldMatch[1] : 'unknown field';
            
            logInfo(`[ORCHESTRATOR] Non-queryable field error (400): ${fieldName} in ${step.description}`);
            logInfo(`[ORCHESTRATOR] Attempting fallback to V3 Search API...`);
            
            // Try to use V3 Search API as fallback
            try {
              const { executeSearchQuery, executeSearchCount } = await import('./sailpoint-search.js');
              const config = await import('./sailpoint.js').then(m => m.getSailpointConfig(context.customerId, context.environment));
              
              if (!config) {
                throw new Error('No SailPoint config available for search fallback');
              }

              // Extract resource type from action
              const actionMatch = step.query.action.match(/^(?:search_|count_)?(.+)$/);
              const resourceType = actionMatch ? actionMatch[1].replace(/_/g, '-') : 'identities';
              
              // Determine if this is a count query
              const isCountQuery = step.query.action.startsWith('count_');
              
              if (isCountQuery) {
                // Use dedicated count function
                const count = await executeSearchCount(
                  config,
                  resourceType,
                  step.query.filters
                );
                
                result = {
                  data: [],
                  count: count,
                  totalCount: count,
                  type: 'count',
                  resource: resourceType,
                  fallbackUsed: 'v3-search'
                };
                
                logInfo(`[ORCHESTRATOR] V3 Search API fallback succeeded for count query: ${count}`);
              } else {
                // Regular search query
                const limit = step.query.limit || 250;
                const offset = step.query.offset || 0;
                
                const searchResults = await executeSearchQuery(
                  config,
                  resourceType,
                  step.query.filters,
                  limit,
                  offset,
                  false
                );
                
                result = {
                  data: searchResults,
                  count: searchResults.length,
                  totalCount: searchResults.length,
                  fallbackUsed: 'v3-search'
                };
                
                logInfo(`[ORCHESTRATOR] V3 Search API fallback succeeded: ${searchResults.length} results`);
              }
              
              if (onProgress) {
                onProgress({
                  type: 'step_progress',
                  stepNumber: step.stepNumber,
                  totalSteps: plan.steps.length,
                  description: `Used V3 Search API fallback for non-queryable field "${fieldName}"`,
                  data: {
                    fallback: 'v3-search',
                    itemsRetrieved: result.data?.length || result.count || 0
                  }
                });
              }
            } catch (searchError: any) {
              logError(`[ORCHESTRATOR] V3 Search API fallback failed:`, searchError);
              
              // Return empty result with explanation
              result = {
                data: [],
                count: 0,
                totalCount: 0,
                type: 'non_queryable_field',
                error: queryError.message,
                field: fieldName,
                fallbackAttempted: true,
                fallbackError: searchError.message
              };
              
              if (onProgress) {
                onProgress({
                  type: 'step_progress',
                  stepNumber: step.stepNumber,
                  totalSteps: plan.steps.length,
                  description: `Field "${fieldName}" is not queryable and fallback failed - continuing with empty result`,
                  data: {
                    warning: `The field "${fieldName}" cannot be used in filters. V3 Search API fallback was attempted but also failed.`
                  }
                });
              }
            }
          } else {
            // Other errors should still fail the orchestration
            throw queryError;
          }
        }

        if (result.error && result.type !== 'not_found' && result.type !== 'non_queryable_field') {
          throw new Error(result.error);
        }

        // Check for empty results that might indicate filter issues
        const isEmpty = result.data && Array.isArray(result.data) && result.data.length === 0;
        const hasFilter = step.query.filters;
        const isSearchQuery = step.query.action.startsWith('search_');
        
        if (isEmpty && hasFilter && isSearchQuery && !step.query._retried) {
          logInfo(`[ORCHESTRATOR] Query returned 0 results with filter: ${step.query.filters}`);
          
          // Check if filter might be using unsupported operators
          const resource = step.query.action.replace('search_', '').replace(/_/g, '-');
          const { correctFilter } = await import('./sailpoint-api-filters');
          const { corrected, wasModified, changes } = correctFilter(resource, step.query.filters);
          
          if (wasModified) {
            logInfo(`[ORCHESTRATOR] 0 results might be due to invalid filter. Retrying with corrected filter`);
            changes.forEach(change => logInfo(`  - ${change}`));
            
            const retryQuery = { ...step.query, filters: corrected, _retried: true };
            
            try {
              const retryResult = await executeSailPointQuery(context, retryQuery);
              
              if (!retryResult.error && retryResult.data && retryResult.data.length > 0) {
                logInfo(`[ORCHESTRATOR] Retry with corrected filter found ${retryResult.data.length} results!`);
                
                // Use retry result instead
                result.data = retryResult.data;
                result.count = retryResult.count;
                result.totalCount = retryResult.totalCount;
                
                if (onProgress) {
                  onProgress({
                    type: 'step_progress',
                    stepNumber: step.stepNumber,
                    totalSteps: plan.steps.length,
                    description: `Auto-corrected filter and found ${retryResult.data.length} results`,
                    data: {
                      correction: changes.join('; ')
                    }
                  });
                }
              } else {
                logInfo(`[ORCHESTRATOR] Retry also returned 0 results - filter may be correct, just no matches`);
                
                // INTELLIGENT RETRY: If filter still returns 0, and we're searching for text "in" or "with" name,
                // try fetching ALL items without filter so AI can search through them client-side
                const isTextSearchInName = step.query.filters.includes('name') && 
                  (step.description.toLowerCase().includes('with') || 
                   step.description.toLowerCase().includes('contains') ||
                   step.description.toLowerCase().includes('in the name'));
                
                if (isTextSearchInName && !step.query._retriedWithoutFilter) {
                  logInfo(`[ORCHESTRATOR] Detected text search in name. Trying without filter to get all items for client-side filtering`);
                  
                  const noFilterQuery = { 
                    ...step.query, 
                    filters: undefined, 
                    _retriedWithoutFilter: true 
                  };
                  
                  try {
                    const allItemsResult = await executeSailPointQuery(context, noFilterQuery);
                    
                    if (!allItemsResult.error && allItemsResult.data && allItemsResult.data.length > 0) {
                      logInfo(`[ORCHESTRATOR] Fetched ${allItemsResult.data.length} total items for client-side filtering`);
                      
                      // Use all items - let synthesis AI filter them
                      result.data = allItemsResult.data;
                      result.count = allItemsResult.count;
                      result.totalCount = allItemsResult.totalCount;
                      result.clientSideFilterNeeded = true; // Flag for synthesis
                      
                      if (onProgress) {
                        onProgress({
                          type: 'step_progress',
                          stepNumber: step.stepNumber,
                          totalSteps: plan.steps.length,
                          description: `Filter returned 0 results. Fetched all ${allItemsResult.data.length} items for manual filtering`,
                          data: {
                            note: 'AI will search through all items to find matches'
                          }
                        });
                      }
                    }
                  } catch (noFilterError: any) {
                    logError(`[ORCHESTRATOR] Fetch all items failed:`, noFilterError);
                  }
                }
              }
            } catch (retryError: any) {
              logError(`[ORCHESTRATOR] Retry failed:`, retryError);
              // Continue with original empty result
            }
          }
        }

        // DISCOVERY STEP: Check if this is a discovery step and handle schema extraction BEFORE filtering
        const isDiscoveryStep = step.stepNumber === 1 && step.description.toLowerCase().includes('discover');
        let discoveredSchema: any = null;
        
        if (isDiscoveryStep && result.data && result.data.length > 0) {
          discoveredSchema = result.data[0]; // Use UNFILTERED data for schema discovery
          
          // Log the COMPLETE schema as JSON for full visibility
          logInfo(`[ORCHESTRATOR] ========== COMPLETE SCHEMA DISCOVERED ==========`);
          logInfo(JSON.stringify(discoveredSchema, null, 2));
          logInfo(`[ORCHESTRATOR] ===============================================`);
          
          // Discover ALL field paths including deeply nested ones
          const allFieldPaths = discoverAllFieldPaths(discoveredSchema);
          const topLevelFields = Object.keys(discoveredSchema);
          
          logInfo(`[ORCHESTRATOR] Schema Analysis:`);
          logInfo(`[ORCHESTRATOR]   Top-level fields (${topLevelFields.length}): ${topLevelFields.join(', ')}`);
          logInfo(`[ORCHESTRATOR]   All field paths discovered (${allFieldPaths.length} total)`);
          
          // If plan didn't specify requiredFields, use intelligent selection
          if (!plan.requiredFields || plan.requiredFields.length === 0) {
            plan.requiredFields = selectIntelligentFields(discoveredSchema, allFieldPaths);
            
            logInfo(`[ORCHESTRATOR] Intelligently selected ${plan.requiredFields.length} fields based on schema analysis`);
            logInfo(`[ORCHESTRATOR]   Selected fields: ${plan.requiredFields.join(', ')}`);
          } else {
            // Plan specified fields - validate them against discovered schema
            const missingFields = plan.requiredFields.filter(f => !allFieldPaths.includes(f) && !topLevelFields.includes(f.split('.')[0]));
            if (missingFields.length > 0) {
              logInfo(`[ORCHESTRATOR] WARNING: Requested fields not found in schema: ${missingFields.join(', ')}`);
              // Remove missing fields from requiredFields
              plan.requiredFields = plan.requiredFields.filter(f => allFieldPaths.includes(f) || topLevelFields.includes(f.split('.')[0]));
              logInfo(`[ORCHESTRATOR] Adjusted requiredFields to available fields: ${plan.requiredFields.join(', ')}`);
            } else {
              logInfo(`[ORCHESTRATOR] All ${plan.requiredFields.length} requested fields are available`);
            }
          }
          
          // Store schema for context in final synthesis
          if (onProgress) {
            onProgress({
              type: 'step_progress',
              stepNumber: step.stepNumber,
              totalSteps: plan.steps.length,
              description: `Schema discovered and analyzed - selected ${plan.requiredFields?.length || 0} fields`,
              data: {
                schema: discoveredSchema,
                topLevelFields,
                allFieldPaths: allFieldPaths.slice(0, 100), // Limit for performance
                selectedFields: plan.requiredFields
              }
            });
          }
        }

        // Apply field filtering if requiredFields are specified (AFTER discovery)
        let filteredResult = result;
        if (plan.requiredFields && plan.requiredFields.length > 0 && result.data && Array.isArray(result.data)) {
          filteredResult = {
            ...result,
            data: result.data.map((item: any) => filterToRequiredFields(item, plan.requiredFields!))
          };
          logInfo(`[ORCHESTRATOR] Filtered results to ${plan.requiredFields.length} fields: ${plan.requiredFields.join(', ')}`);
        }

        // REFERENCE EXPANSION: Automatically detect and expand nested references
        // This fetches full objects for any ID/name references found in the data
        // SKIP reference expansion for count queries - they don't have expandable data
        const isCountQuery = step.query.action?.startsWith('count_');
        const isCountResult = filteredResult.type === 'count';
        
        if (filteredResult.data && Array.isArray(filteredResult.data) && filteredResult.data.length > 0 && !isDiscoveryStep && !isCountQuery && !isCountResult) {
          logInfo(`[ORCHESTRATOR] Starting reference expansion for ${filteredResult.data.length} items`);
          
          try {
            const expandedData = await expandReferences(
              filteredResult.data,
              context,
              1 // Max depth of 1 to prevent loops and keep response manageable
            );
            
            if (expandedData && expandedData.length > 0) {
              filteredResult = {
                ...filteredResult,
                data: expandedData
              };
              logInfo(`[ORCHESTRATOR] Reference expansion complete - data enriched with nested objects`);
              
              if (onProgress) {
                onProgress({
                  type: 'step_progress',
                  stepNumber: step.stepNumber,
                  totalSteps: plan.steps.length,
                  description: `Expanded nested references in ${expandedData.length} items`,
                  data: {
                    itemsExpanded: expandedData.length
                  }
                });
              }
            }
          } catch (expansionError: any) {
            logError(`[ORCHESTRATOR] Reference expansion failed: ${expansionError.message}`);
            // Continue with un-expanded data if expansion fails
          }
        } else if (isCountQuery || isCountResult) {
          logInfo(`[ORCHESTRATOR] Skipping reference expansion for count query`);
        }

        // Store result
        step.result = filteredResult;
        step.status = 'completed';
        completedSteps++;
        
        // Handle result accumulation differently for discovery vs regular steps
        if (isDiscoveryStep) {
          // Don't add discovery results to main results (just used for schema)
          if (onProgress) {
            onProgress({
              type: 'step_completed',
              stepNumber: step.stepNumber,
              totalSteps: plan.steps.length,
              description: `Schema discovered: ${Object.keys(discoveredSchema || {}).length} fields available`,
              data: {
                itemsFetched: 0,
                totalSoFar: allResults.length,
                selectedFields: plan.requiredFields?.join(', ')
              }
            });
          }
        } else {
          // Accumulate filtered data for non-discovery steps
          if (filteredResult.data && Array.isArray(filteredResult.data)) {
            allResults.push(...filteredResult.data);
          } else if (filteredResult.type === 'count') {
            // For count queries, store the count result
            allResults.push(filteredResult);
          }

          if (onProgress) {
            onProgress({
              type: 'step_completed',
              stepNumber: step.stepNumber,
              totalSteps: plan.steps.length,
              description: `Completed: ${step.description}`,
              data: {
                itemsFetched: filteredResult.data?.length || (filteredResult.type === 'count' ? 1 : 0),
                totalSoFar: allResults.length
              }
            });
          }
        }
      }

      // Small delay between steps to avoid rate limiting
      if (stepIndex < plan.steps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error: any) {
      logError(`[ORCHESTRATOR] Step ${step.stepNumber} failed:`, error);
      
      // Check if this is a filter-related error that we can auto-correct and retry
      const isFilterError = error.message?.includes('Match mode') || 
                           error.message?.includes('not supported') ||
                           error.message?.includes('filter');
      
      if (isFilterError && step.query.filters && !step.query._retried) {
        logInfo(`[ORCHESTRATOR] Filter error detected, attempting auto-correction and retry`);
        
        // Extract resource from action
        const actionMatch = step.query.action.match(/^search_(.+)$/);
        if (actionMatch) {
          const resource = actionMatch[1].replace(/_/g, '-');
          
          // Import filter correction
          const { correctFilter } = await import('./sailpoint-api-filters');
          const { corrected, wasModified, changes } = correctFilter(resource, step.query.filters);
          
          if (wasModified) {
            logInfo(`[ORCHESTRATOR] Retrying with corrected filter: ${corrected}`);
            changes.forEach(change => logInfo(`  - ${change}`));
            
            // Mark as retried to prevent infinite loops
            const retryQuery = { ...step.query, filters: corrected, _retried: true };
            
            try {
              const retryResult = await executeSailPointQuery(context, retryQuery);
              
              if (!retryResult.error) {
                logInfo(`[ORCHESTRATOR] Retry successful!`);
                step.result = retryResult;
                step.status = 'completed';
                completedSteps++;
                
                if (retryResult.data && Array.isArray(retryResult.data)) {
                  allResults.push(...retryResult.data);
                }
                
                if (onProgress) {
                  onProgress({
                    type: 'step_completed',
                    stepNumber: step.stepNumber,
                    totalSteps: plan.steps.length,
                    description: `Completed (after auto-correction): ${step.description}`,
                    data: {
                      itemsFetched: retryResult.data?.length || 0,
                      totalSoFar: allResults.length,
                      correctionApplied: changes.join('; ')
                    }
                  });
                }
                
                // Successfully recovered, continue to next step
                continue;
              }
            } catch (retryError: any) {
              logError(`[ORCHESTRATOR] Retry also failed:`, retryError);
              step.error = `Original error: ${error.message}. Retry error: ${retryError.message}`;
            }
          }
        }
      }
      
      // If we get here, retry failed or wasn't applicable
      step.status = 'failed';
      step.error = error.message;
      failedSteps++;

      if (onProgress) {
        onProgress({
          type: 'step_failed',
          stepNumber: step.stepNumber,
          totalSteps: plan.steps.length,
          description: `Failed: ${step.description} - ${error.message}`
        });
      }

      // Continue with remaining steps even if one fails
    }
  }

  const success = failedSteps === 0;
  const summary = success
    ? `Successfully completed all ${completedSteps} steps, fetched ${allResults.length} items`
    : `Completed ${completedSteps}/${plan.steps.length} steps (${failedSteps} failed), fetched ${allResults.length} items`;

  logInfo(`[ORCHESTRATOR] Execution complete: ${summary}`);

  if (onProgress) {
    onProgress({
      type: 'all_completed',
      totalSteps: plan.steps.length,
      description: summary,
      data: {
        totalItemsFetched: allResults.length,
        completedSteps,
        failedSteps
      }
    });
  }

  return {
    success,
    results: allResults,
    summary,
    discoveredSchema,
    metadata: {
      totalSteps: plan.steps.length,
      completedSteps,
      failedSteps,
      totalItemsFetched: allResults.length
    }
  };
}

/**
 * Analyze query results and determine if follow-up queries are needed
 * Returns refined queries to get better/more complete results
 */
export async function analyzeResultsAndRefine(
  userIntent: string,
  originalQuery: any,
  results: any[],
  workspaceSlug: string
): Promise<{
  needsRefinement: boolean;
  reasoning: string;
  followUpQueries?: any[];
  recommendations?: string[];
}> {
  logInfo(`[ORCHESTRATOR] Analyzing results for potential refinement`);

  // CRITICAL: Count queries should generally not be refined, BUT there's an exception:
  // If user asked for "breakdown by X" or "for each X" but got a single count, we need refinement
  const isCountQuery = originalQuery.action && originalQuery.action.startsWith('count_');
  const hasCountResults = results.some((r: any) => r.type === 'count');
  const hasMultipleCounts = results.filter((r: any) => r.type === 'count').length > 1;
  const userWantsBreakdown = /\b(for each|per|breakdown|by source|by type|individual)\b/i.test(userIntent);
  
  if ((isCountQuery || hasCountResults) && (!userWantsBreakdown || hasMultipleCounts)) {
    logInfo(`[ORCHESTRATOR] Count query complete - no refinement needed (${hasMultipleCounts ? 'multiple counts already' : 'simple count'})`);
    return {
      needsRefinement: false,
      reasoning: 'Count queries are complete as-is'
    };
  } else if (isCountQuery && userWantsBreakdown && !hasMultipleCounts) {
    logInfo(`[ORCHESTRATOR] Count query detected but user wants breakdown - refinement may be needed`);
  }

  // Check for common issues that suggest refinement
  const isEmpty = results.length === 0;
  const hasFilter = originalQuery.filters;
  const isTooManyResults = results.length > 100 && results.length === originalQuery.limit;
  const hasPartialData = results.some((r: any) => r.filterCorrected);

  // Build analysis context
  const resultSummary = isEmpty 
    ? "Query returned 0 results"
    : `Query returned ${results.length} results${isTooManyResults ? ' (may be truncated)' : ''}`;

  const analysisPrompt = `You are a SailPoint query refinement expert. Analyze the query results and determine if follow-up queries would help.

User's Original Request: "${userIntent}"

Query Executed: ${JSON.stringify(originalQuery, null, 2)}

Result Summary: ${resultSummary}
${hasPartialData ? `Note: Filter was auto-corrected during execution` : ''}

Results Sample: ${isEmpty ? 'No results' : JSON.stringify(results.slice(0, 3), null, 2)}

Your task:
1. Determine if the user got what they asked for
2. Check if results seem incomplete or incorrect
3. Suggest alternative queries if needed

Respond with JSON:
{
  "needsRefinement": true/false,
  "reasoning": "explanation of why refinement is/isn't needed",
  "followUpQueries": [
    {
      "action": "search_xxx or count_xxx",
      "filters": "optional filter",
      "limit": 250,
      "description": "what this query will find"
    }
  ],
  "recommendations": [
    "suggestion 1",
    "suggestion 2"
  ]
}

REFINEMENT SCENARIOS:

1. **User Asked for Breakdown/Per-Item Counts but Got Single Count**:
   - CRITICAL: If user said "for each", "per", "breakdown by source/type", they want MULTIPLE counts
   - Check results: do we have one count or multiple?
   - If results are SOURCE OBJECTS (have id/name fields), user wants COUNT per source
   - If single count but user wants breakdown: NEED REFINEMENT
   - **USE count_xxx queries with filters - DO NOT fetch all data!**
   - Generate count_xxx queries with filters for EACH item
   - Example: User asks "account counts for each AD source"
     → Got 3 AD sources [{id: "abc-123", name: "Source 1"}, {id: "def-456", name: "Source 2"}, ...]
     → User wants COUNT OF ACCOUNTS per source, not the source objects!
     → Need 3 separate count_accounts queries:
       * {"action": "count_accounts", "filters": "sourceId eq \\"abc-123\\"", "description": "Count accounts for Source 1"}
       * {"action": "count_accounts", "filters": "sourceId eq \\"def-456\\"", "description": "Count accounts for Source 2"}
       * {"action": "count_accounts", "filters": "sourceId eq \\"ghi-789\\"", "description": "Count accounts for Source 3"}
   - **NEVER** suggest search_accounts to fetch all accounts for counting!
   - **NEVER** suggest pagination queries (offset: 1000, 1250, etc.) for counting!
   - Use the SOURCE IDs from results to build filters
   - Set needsRefinement: true and provide count queries with specific filters

2. **Zero Results with Filter**:
   - Try broader filter (e.g., change 'eq' to 'sw')
   - Try removing filter to see if any data exists
   - Try different field names

3. **Zero Results, No Filter**:
   - Resource might be empty (legitimate)
   - Suggest checking related resources
   - No refinement needed if this is just an empty dataset

4. **Too Many Results** (hit limit):
   - For COUNT questions: NEVER fetch all data!
   - Suggest using count_xxx with filters instead
   - For other questions: suggest more specific filters

5. **Unexpected Data**:
   - If user asked for "Cornerstone transforms" but got all transforms
   - If filter didn't seem to apply correctly
   - Suggest more specific query

6. **Filter Auto-Corrected**:
   - Explain what was changed
   - Results are likely correct
   - Usually no refinement needed

IMPORTANT:
- Don't refine if results look good
- Don't suggest queries that won't help
- Consider whether 0 results is legitimate (empty dataset)
- For transforms: remember only 'eq' and 'sw' operators work on name field
`;

  try {
    const response = await anythingllmRequest<{ textResponse?: string }>(
      `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
      "POST",
      {
        message: analysisPrompt,
        mode: 'chat',
        sessionId: 'system-result-analyzer'
      }
    );

    const analysisText = response.textResponse || '';
    
    // Extract JSON from response
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logError('[ORCHESTRATOR] Failed to extract refinement analysis');
      return {
        needsRefinement: false,
        reasoning: 'Could not analyze results'
      };
    }

    const analysis = JSON.parse(jsonMatch[0]);
    logInfo(`[ORCHESTRATOR] Refinement analysis: ${analysis.needsRefinement ? 'YES' : 'NO'} - ${analysis.reasoning}`);

    return analysis;
  } catch (error: any) {
    logError('[ORCHESTRATOR] Error analyzing results:', error);
    return {
      needsRefinement: false,
      reasoning: 'Analysis failed'
    };
  }
}

/**
 * Execute query with intelligent refinement loop
 * Automatically retries with better queries if initial results are poor
 */
export async function executeWithRefinement(
  userIntent: string,
  context: SailPointContext,
  workspaceSlug: string,
  maxRefinementAttempts: number = 2,
  onProgress?: (update: ProgressUpdate) => void
): Promise<{
  success: boolean;
  results: any[];
  summary: string;
  refinementHistory?: Array<{
    attempt: number;
    query: any;
    resultCount: number;
    reasoning: string;
  }>;
  metadata: any;
}> {
  logInfo(`[ORCHESTRATOR] Starting execution with refinement for: "${userIntent}"`);

  const refinementHistory: Array<{
    attempt: number;
    query: any;
    resultCount: number;
    reasoning: string;
  }> = [];

  let currentAttempt = 0;
  let finalResults: any[] = [];
  let finalMetadata: any = {};

  while (currentAttempt < maxRefinementAttempts) {
    currentAttempt++;
    logInfo(`[ORCHESTRATOR] Refinement attempt ${currentAttempt}/${maxRefinementAttempts}`);

    // Create plan for this attempt
    const plan = await analyzeAndPlanQuery(
      currentAttempt === 1 ? userIntent : `${userIntent}\n\nPrevious attempts didn't find what we need. Try a different approach.`,
      '', // No context for now
      workspaceSlug
    );

    // Execute the plan
    const execution = await executeQueryPlan(plan, context, onProgress);

    // Record this attempt
    refinementHistory.push({
      attempt: currentAttempt,
      query: plan.steps[0]?.query || {},
      resultCount: execution.results.length,
      reasoning: plan.strategy
    });

    // Check if we got good results
    if (execution.results.length > 0) {
      // CRITICAL: Don't refine count queries UNLESS user wants a breakdown
      const hasCountResults = execution.results.some((r: any) => r.type === 'count');
      const isCountPlan = plan.steps.some((s: any) => s.query?.action?.startsWith('count_'));
      const hasMultipleCounts = execution.results.filter((r: any) => r.type === 'count').length > 1;
      const userWantsBreakdown = /\b(for each|per|breakdown|by source|by type|individual)\b/i.test(userIntent);
      
      if ((hasCountResults || isCountPlan) && (!userWantsBreakdown || hasMultipleCounts)) {
        logInfo(`[ORCHESTRATOR] Count query complete - refinement skipped (${hasMultipleCounts ? 'multiple counts already' : 'simple count'})`);
        finalResults = execution.results;
        finalMetadata = execution.metadata;
        break;
      } else if ((hasCountResults || isCountPlan) && userWantsBreakdown && !hasMultipleCounts) {
        logInfo(`[ORCHESTRATOR] Count query detected but user wants breakdown - allowing refinement`);
      }
      
      // Found results! But should we refine further?
      const analysis = await analyzeResultsAndRefine(
        userIntent,
        plan.steps[0]?.query || {},
        execution.results,
        workspaceSlug
      );

      if (!analysis.needsRefinement || currentAttempt >= maxRefinementAttempts) {
        // Results are good enough, or we've hit max attempts
        logInfo(`[ORCHESTRATOR] Refinement complete: ${execution.results.length} results found`);
        finalResults = execution.results;
        finalMetadata = execution.metadata;
        break;
      }

      // Results exist but might need refinement
      logInfo(`[ORCHESTRATOR] Results found but refinement suggested: ${analysis.reasoning}`);
      
      if (analysis.followUpQueries && analysis.followUpQueries.length > 0) {
        // Execute follow-up queries suggested by analysis
        logInfo(`[ORCHESTRATOR] Executing ${analysis.followUpQueries.length} follow-up queries`);
        
        const followUpResults: any[] = [];
        let successfulFollowUps = 0;
        
        // Build a map of source IDs to names from original results (if they're sources)
        const sourceMap = new Map<string, string>();
        execution.results.forEach((r: any) => {
          if (r.id && r.name) {
            sourceMap.set(r.id, r.name);
          }
        });
        
        for (const followUpQuery of analysis.followUpQueries) {
          try {
            const { executeSailPointQuery } = await import('./sailpointChatIntegration');
            const followUpResult = await executeSailPointQuery(context, followUpQuery);
            
            if (!followUpResult.error) {
              successfulFollowUps++;
              
              // Handle both regular data results and count results
              if (followUpResult.type === 'count') {
                logInfo(`[ORCHESTRATOR] Follow-up count query: ${followUpResult.count} items`);
                
                // Extract sourceId from filter to create enriched result
                let sourceInfo = null;
                if (followUpQuery.filters) {
                  const sourceIdMatch = followUpQuery.filters.match(/(?:source\.?id|sourceId)\s+eq\s+['""]([^'""]+)['"\"]/i);
                  if (sourceIdMatch) {
                    const sourceId = sourceIdMatch[1];
                    const sourceName = sourceMap.get(sourceId) || followUpQuery.description || sourceId;
                    sourceInfo = { id: sourceId, name: sourceName };
                  }
                }
                
                // Create enriched result with source context
                const enrichedCountResult = sourceInfo 
                  ? {
                      sourceItem: sourceInfo,
                      type: 'count',
                      resource: followUpResult.resource,
                      count: followUpResult.count
                    }
                  : followUpResult;
                
                followUpResults.push(enrichedCountResult);
              } else if (followUpResult.data && Array.isArray(followUpResult.data) && followUpResult.data.length > 0) {
                logInfo(`[ORCHESTRATOR] Follow-up query found ${followUpResult.data.length} results`);
                followUpResults.push(...followUpResult.data);
              }
            } else {
              logError(`[ORCHESTRATOR] Follow-up query returned error: ${followUpResult.error}`);
            }
          } catch (error: any) {
            logError('[ORCHESTRATOR] Follow-up query failed:', error);
          }
        }
        
        if (followUpResults.length > 0) {
          logInfo(`[ORCHESTRATOR] Follow-up queries completed: ${successfulFollowUps}/${analysis.followUpQueries.length} successful, ${followUpResults.length} total results`);
          
          // For breakdown queries, REPLACE original results with follow-up results
          // For other refinements, merge them
          if (userWantsBreakdown) {
            finalResults = followUpResults;
          } else {
            finalResults = [...execution.results, ...followUpResults];
          }
          
          finalMetadata = { 
            ...execution.metadata,
            refinementApplied: true,
            followUpQueriesExecuted: successfulFollowUps
          };
          break;
        } else {
          logInfo(`[ORCHESTRATOR] Follow-up queries didn't produce additional results`);
        }
      }
    }

    // No results or refinement didn't help
    if (currentAttempt >= maxRefinementAttempts) {
      logInfo(`[ORCHESTRATOR] Max refinement attempts reached`);
      finalResults = execution.results;
      finalMetadata = execution.metadata;
      break;
    }
  }

  const success = finalResults.length > 0;
  const summary = success
    ? `Found ${finalResults.length} results after ${currentAttempt} attempt(s)`
    : `No results found after ${currentAttempt} attempt(s)`;

  return {
    success,
    results: finalResults,
    summary,
    refinementHistory,
    metadata: {
      ...finalMetadata,
      refinementAttempts: currentAttempt,
      refinementHistory
    }
  };
}

/**
 * Intelligently aggregate results for synthesis
 */
export function aggregateForSynthesis(
  results: any[],
  userIntent: string
): string {
  logInfo(`[ORCHESTRATOR] aggregateForSynthesis called with ${results.length} results`);
  
  if (results.length === 0) {
    return 'No data found.';
  }

  // Check for non-queryable field errors
  const nonQueryableErrors = results.filter(r => r.type === 'non_queryable_field');
  const fallbackUsed = results.some(r => r.fallbackUsed === 'v3-search');
  let warningMessage = '';
  
  if (nonQueryableErrors.length > 0) {
    const fields = nonQueryableErrors.map(e => e.field).filter(Boolean);
    const hadFallbackError = nonQueryableErrors.some(e => e.fallbackAttempted);
    
    if (hadFallbackError) {
      warningMessage = `\n\nIMPORTANT: The following fields are not queryable in SailPoint standard endpoints: ${fields.join(', ')}. V3 Search API fallback was attempted but also failed. These are likely custom attributes or non-indexed fields.\n`;
    } else {
      warningMessage = `\n\nIMPORTANT: The following fields are not queryable in SailPoint standard endpoints: ${fields.join(', ')}. These are likely custom attributes or non-indexed fields.\n`;
    }
    
    logInfo(`[ORCHESTRATOR] Non-queryable fields detected: ${fields.join(', ')}`);
    
    // Remove the error results from the main results array
    results = results.filter(r => r.type !== 'non_queryable_field');
    
    // If all results were errors, return just the warning
    if (results.length === 0) {
      return warningMessage.trim();
    }
  }
  
  // Add note if V3 Search API fallback was used successfully
  if (fallbackUsed && !nonQueryableErrors.length) {
    warningMessage += `\n\nNote: V3 Search API was used to retrieve results for fields that are not queryable via standard endpoints.\n`;
  }

  // Handle enriched results from dependent queries (e.g., sources with counts)
  const hasEnrichedResults = results.some(r => r.sourceItem && (r.type === 'count' || r.type === 'aggregated'));
  if (hasEnrichedResults) {
    const enrichedData = results
      .filter(r => r.sourceItem)
      .map(r => ({
        source: r.sourceItem.name || r.sourceItem.id,
        count: r.count || (r.data?.length || 0),
        type: r.resource || 'items'
      }));
    
    // Format as simple text breakdown
    const breakdown = enrichedData
      .map(item => `${item.source}: ${item.count} ${item.type}`)
      .join('\n');
    
    return `Breakdown by source:\n${breakdown}\n\nTotal sources: ${enrichedData.length}${warningMessage}`;
  }

  // Handle count queries specifically
  if (results.length === 1 && results[0].type === 'count') {
    const countResult = results[0];
    return JSON.stringify({
      resource: countResult.resource,
      count: countResult.count,
      message: `Found ${countResult.count} ${countResult.resource}`
    }, null, 2) + warningMessage;
  }

  // Handle multiple count queries (e.g., health check scenarios)
  const allCounts = results.every(r => r.type === 'count');
  if (allCounts && results.length > 1) {
    logInfo(`[ORCHESTRATOR] Formatting ${results.length} count results for health check`);
    const countsFormatted = results.map(r => ({
      resource: r.resource,
      count: r.count,
      message: `Total ${r.resource}: ${r.count}`
    }));
    return JSON.stringify(countsFormatted, null, 2) + warningMessage;
  }

  // Detect aggregation type from intent
  const intent = userIntent.toLowerCase();
  
  // Be more specific about aggregation keywords to avoid false matches
  if (intent.includes('by source') || intent.includes('per source') || intent.includes('group by source') || intent.includes('breakdown by source')) {
    logInfo(`[ORCHESTRATOR] Aggregating by source based on intent`);
    return aggregateByField(results, 'source') + warningMessage;
  }
  
  if (intent.includes('by owner') || intent.includes('per owner') || intent.includes('group by owner')) {
    logInfo(`[ORCHESTRATOR] Aggregating by owner based on intent`);
    return aggregateByField(results, 'owner') + warningMessage;
  }
  
  if (intent.includes('by type') || intent.includes('per type') || intent.includes('group by type')) {
    logInfo(`[ORCHESTRATOR] Aggregating by type based on intent`);
    return aggregateByField(results, 'type') + warningMessage;
  }

  // For large datasets, provide summary + sample
  if (results.length > 100) {
    const summary = {
      totalItems: results.length,
      sample: results.slice(0, 10).map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        ...(item.source ? { source: item.source.name } : {}),
        ...(item.owner ? { owner: item.owner.name } : {})
      })),
      note: `Showing 10 of ${results.length} items. Full data available for analysis.`
    };
    return JSON.stringify(summary, null, 2) + warningMessage;
  }

  // Small dataset - return compact version with only key fields
  logInfo(`[ORCHESTRATOR] Creating compact results for ${results.length} items`);
  const compactResults = results.map(item => {
    // Handle count results differently - they have a different structure
    if (item.type === 'count') {
      return {
        type: 'count',
        resource: item.resource,
        count: item.count,
        message: `Total ${item.resource}: ${item.count}`
      };
    }
    
    // Extract all _expanded fields from reference expansion
    const expandedFields: any = {};
    Object.keys(item).forEach(key => {
      if (key.endsWith('_expanded')) {
        expandedFields[key] = (item as any)[key];
      }
    });
    
    // Regular item results
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      description: item.description,
      ...(item.source ? { source: item.source.name } : {}),
      ...(item.owner ? { owner: item.owner.name } : {}),
      ...(item.status ? { status: item.status } : {}),
      ...(item.connector ? { connector: item.connector } : {}),
      ...(item.created ? { created: item.created } : {}),
      // Include attributes for transforms (contains the logic/configuration)
      ...(item.attributes ? { attributes: item.attributes } : {}),
      // Include identityAttributeConfig for identity profiles (contains attribute mappings and transforms)
      ...(item.identityAttributeConfig ? { identityAttributeConfig: item.identityAttributeConfig } : {}),
      // Include other important configuration fields
      ...(item.authoritativeSource ? { authoritativeSource: item.authoritativeSource } : {}),
      ...(item.identityRefreshRequired ? { identityRefreshRequired: item.identityRefreshRequired } : {}),
      ...(item.hasTimeBasedAttr ? { hasTimeBasedAttr: item.hasTimeBasedAttr } : {}),
      // Include all expanded reference data from reference expansion
      ...expandedFields
    };
  });
  
  const compactJson = JSON.stringify(compactResults, null, 2);
  logInfo(`[ORCHESTRATOR] Returning compact results: ${compactResults.length} items, ${compactJson.length} chars`);
  const sampleNames = compactResults.slice(0, 3).map(r => (r as any).name || (r as any).resource || 'unknown').join(', ');
  logInfo(`[ORCHESTRATOR] First 3 item names: ${sampleNames}`);
  return compactJson + warningMessage;
}

function aggregateByField(results: any[], field: 'source' | 'owner' | 'type'): string {
  const breakdown: Record<string, number> = {};
  const items: Record<string, any[]> = {};

  results.forEach(item => {
    let key: string;
    
    if (field === 'source') {
      key = item.source?.name || 'Unknown Source';
    } else if (field === 'owner') {
      key = item.owner?.name || 'Unknown Owner';
    } else {
      key = item.type || 'Unknown Type';
    }

    breakdown[key] = (breakdown[key] || 0) + 1;
    
    if (!items[key]) {
      items[key] = [];
    }
    // Store only 3 samples per category for better context
    if (items[key].length < 3) {
      items[key].push({
        id: item.id,
        name: item.name,
        type: item.type,
        ...(item.status ? { status: item.status } : {})
      });
    }
  });

  // Sort by count descending
  const sorted = Object.entries(breakdown).sort(([,a], [,b]) => b - a);

  let output = `BREAKDOWN BY ${field.toUpperCase()} (${results.length} total items)\n\n`;
  output += `SUMMARY:\n`;
  
  sorted.forEach(([key, count]) => {
    const percentage = ((count / results.length) * 100).toFixed(1);
    output += `${key}: ${count} items (${percentage}%)\n`;
  });

  output += `\nSAMPLE ITEMS (top 5 categories):\n`;
  sorted.slice(0, 5).forEach(([key]) => {
    output += `\n${key} (${breakdown[key]} total):\n`;
    items[key].forEach(item => {
      output += `  - ${item.name}`;
      if (item.status) output += ` [${item.status}]`;
      output += `\n`;
    });
  });

  return output;
}

/**
 * Analyze synthesis response to detect if additional queries are needed
 * Returns follow-up query plan if the AI couldn't fully answer the question
 */
export async function detectNeedForAdditionalQueries(
  userIntent: string,
  synthesisResponse: string,
  executionResults: any[],
  workspaceSlug: string,
  lastPlan?: any
): Promise<{
  needsAdditionalQueries: boolean;
  reasoning: string;
  followUpPlan?: any;
}> {
  logInfo(`[ORCHESTRATOR] Analyzing synthesis response for completeness`);

  // Check for indicators that the response is incomplete or couldn't answer fully
  const incompletePhrases = [
    "I don't have",
    "I couldn't",
    "I can't",
    "not enough",
    "unable to",
    "would need",
    "missing",
    "no data",
    "0 results",
    "couldn't retrieve",
    "I don't see",
    "don't have access",
    "not available",
    "however",
    "unfortunately",
    "but",
    "limited",
    "partial",
    "only shows",
    "need more"
  ];

  const hasIncompleteIndicator = incompletePhrases.some(phrase => 
    synthesisResponse.toLowerCase().includes(phrase.toLowerCase())
  );
  
  // Check if we hit pagination limits (results might be truncated)
  const possiblePaginationIssue = executionResults.some((r: any) => 
    r.hasMore === true || 
    (r.data && Array.isArray(r.data) && r.data.length >= 250) ||
    (r.totalCount && r.count && r.totalCount > r.count)
  );

  // ALWAYS ask AI to analyze, even if no obvious incomplete indicators
  // AI is better at determining if the answer is truly complete
  logInfo(`[ORCHESTRATOR] Asking AI to analyze response completeness`);
  if (hasIncompleteIndicator) {
    logInfo(`[ORCHESTRATOR]   Detected incomplete indicators in response`);
  }
  if (possiblePaginationIssue) {
    logInfo(`[ORCHESTRATOR]   Detected possible pagination issue - results may be truncated`);
  }

  // Ask AI to analyze and suggest follow-up queries
  const analysisPrompt = `You are a SailPoint query orchestrator. Analyze this conversation to determine if additional queries would help answer the user's question.

USER'S QUESTION: "${userIntent}"

AI RESPONSE SO FAR:
${synthesisResponse}

QUERY RESULTS OBTAINED (${executionResults.length} result sets):
${JSON.stringify(executionResults.slice(0, 3), null, 2)}
${executionResults.length > 3 ? `... and ${executionResults.length - 3} more result sets` : ''}

${possiblePaginationIssue ? `\n**IMPORTANT**: Some results appear to be paginated/truncated. Consider if more pages are needed.\n` : ''}

TASK:
1. Determine if the response FULLY answered the user's question
2. Check if data appears incomplete, truncated, or missing key information
3. If NOT complete, suggest specific follow-up queries

Be AGGRESSIVE about suggesting follow-ups if:
- The response seems vague or lacks detail
- Key fields mentioned in the question weren't found
- Results were truncated (hit page limits)
- The AI said it "couldn't find" something or has "limited information"

Respond with JSON:
{
  "needsAdditionalQueries": true/false,
  "reasoning": "brief explanation of why more queries are/aren't needed",
  "followUpQueries": [
    {
      "resource": "transforms|identities|sources|accounts|etc",
      "action": "search_transforms|count_identities|etc",
      "filters": "optional filter string",
      "limit": 250,
      "offset": 0,
      "description": "what this query will retrieve",
      "requiredFields": ["field1", "field2"] // only if specific fields needed
    }
  ]
}

AVAILABLE RESOURCES:
- transforms, identities, sources, accounts, entitlements, roles, access-profiles
- connectors, schemas, workflows, governance-groups

FILTER OPERATORS:
- eq (equals): name eq "exact value"
- sw (starts with): name sw "prefix"  
- co (contains): name co "substring" - ONLY works on identities, NOT transforms
- and: combine filters like "type eq 'static' and name sw 'Corp'"

PAGINATION:
- If results show hasMore=true or totalCount > count, suggest additional queries with offset
- Each query can fetch up to 250 items, use offset for next page
- Example: first query offset=0, second query offset=250, third offset=500, etc.

IMPORTANT:
- Be STRICT - if the answer seems incomplete or vague, suggest queries
- Only say "no additional queries" if you're confident the answer is complete
- Don't suggest queries for genuinely empty datasets ("no transforms exist" is valid)
- Consider what the user specifically asked for`;

  try {
    const { anythingllmRequest } = await import('./anythingllm');
    
    const response: any = await anythingllmRequest(
      `/workspace/${workspaceSlug}/chat`,
      'POST',
      {
        message: analysisPrompt,
        mode: 'chat'
      }
    );

    const aiResponse = response.textResponse?.trim() || '';
    
    // Try to extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*"needsAdditionalQueries"[\s\S]*\}/);
    if (!jsonMatch) {
      logInfo(`[ORCHESTRATOR] Could not parse AI analysis response`);
      return {
        needsAdditionalQueries: false,
        reasoning: "Unable to determine if additional queries needed"
      };
    }

    const analysis = JSON.parse(jsonMatch[0]);
    
    if (!analysis.needsAdditionalQueries) {
      logInfo(`[ORCHESTRATOR] AI determined no additional queries needed: ${analysis.reasoning}`);
      return {
        needsAdditionalQueries: false,
        reasoning: analysis.reasoning
      };
    }

    logInfo(`[ORCHESTRATOR] AI suggests ${analysis.followUpQueries?.length || 0} follow-up queries`);
    
    // Convert follow-up queries into a new query plan
    if (analysis.followUpQueries && analysis.followUpQueries.length > 0) {
      const followUpPlan = {
        userIntent: `Follow-up: ${userIntent}`,
        strategy: `Additional queries to complete the original request: ${analysis.reasoning}`,
        estimatedSteps: analysis.followUpQueries.length,
        requiredFields: analysis.followUpQueries[0].requiredFields || [],
        steps: analysis.followUpQueries.map((q: any, idx: number) => ({
          stepNumber: idx + 1,
          query: {
            action: q.action,
            filters: q.filters,
            limit: q.limit || 250,
            offset: q.offset || 0
          },
          description: q.description,
          status: 'pending'
        }))
      };

      return {
        needsAdditionalQueries: true,
        reasoning: analysis.reasoning,
        followUpPlan
      };
    }

    return {
      needsAdditionalQueries: false,
      reasoning: analysis.reasoning
    };

  } catch (error: any) {
    logError(`[ORCHESTRATOR] Error analyzing for follow-up queries:`, error);
    return {
      needsAdditionalQueries: false,
      reasoning: "Error during analysis"
    };
  }
}
