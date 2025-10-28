// backend/src/services/sailpoint-api-filters.ts
// SailPoint V3 API endpoint-specific filter support
// Based on IdentityNow Beta API Postman collection

export interface FilterCapability {
  field: string;
  operators: string[]; // eq, sw, co, ge, le, etc.
}

export interface EndpointFilterConfig {
  endpoint: string;
  filters: FilterCapability[];
  notes?: string;
}

/**
 * Comprehensive mapping of SailPoint V3 API endpoints and their supported filters
 * This is critical - using unsupported operators will result in API errors
 * 
 * Based on IdentityNow Beta API Postman Collection
 * Last updated: 2025-10-27
 */
export const ENDPOINT_FILTER_SUPPORT: Record<string, EndpointFilterConfig> = {
  // Transforms endpoint - VERY LIMITED
  'transforms': {
    endpoint: '/transforms',
    filters: [
      { field: 'internal', operators: ['eq'] },
      { field: 'name', operators: ['eq', 'sw'] } // NO 'co' support!
    ],
    notes: 'Transforms only support equals and starts-with for name field. Use sw for partial matching.'
  },

  // Access Profiles - Standard SCIM support
  'access-profiles': {
    endpoint: '/access-profiles',
    filters: [
      { field: 'id', operators: ['eq', 'sw'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'owner.id', operators: ['eq', 'sw'] },
      { field: 'requestable', operators: ['eq'] },
      { field: 'source.id', operators: ['eq', 'sw'] }
    ]
  },

  // Roles - Standard SCIM support  
  'roles': {
    endpoint: '/roles',
    filters: [
      { field: 'id', operators: ['eq', 'sw'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'owner.id', operators: ['eq', 'sw'] },
      { field: 'requestable', operators: ['eq'] }
    ]
  },

  // Identities - Comprehensive SCIM support
  'identities': {
    endpoint: '/identities',
    filters: [
      { field: 'id', operators: ['eq', 'sw'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'alias', operators: ['eq', 'sw', 'co'] },
      { field: 'email', operators: ['eq', 'sw', 'co'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'manager.id', operators: ['eq'] },
      { field: 'source.id', operators: ['eq', 'sw'] },
      { field: 'inactive', operators: ['eq'] },
      { field: 'protected', operators: ['eq'] },
      { field: 'attributes.{name}', operators: ['eq', 'sw', 'co'] }
    ]
  },

  // Sources
  'sources': {
    endpoint: '/sources',
    filters: [
      { field: 'id', operators: ['eq', 'sw'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'owner.id', operators: ['eq', 'sw'] },
      { field: 'healthy', operators: ['eq'] },
      { field: 'status', operators: ['eq'] },
      { field: 'connectionType', operators: ['eq'] }
    ]
  },

  // Entitlements
  'entitlements': {
    endpoint: '/entitlements',
    filters: [
      { field: 'id', operators: ['eq', 'sw'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'attribute', operators: ['eq', 'sw', 'co'] },
      { field: 'value', operators: ['eq', 'sw', 'co'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'owner.id', operators: ['eq', 'sw'] },
      { field: 'source.id', operators: ['eq', 'sw'] },
      { field: 'privileged', operators: ['eq'] },
      { field: 'requestable', operators: ['eq'] }
    ]
  },

  // Accounts
  'accounts': {
    endpoint: '/accounts',
    filters: [
      { field: 'id', operators: ['eq', 'sw'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'nativeIdentity', operators: ['eq', 'sw', 'co'] },
      { field: 'identityId', operators: ['eq'] },
      { field: 'sourceId', operators: ['eq', 'sw'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'uncorrelated', operators: ['eq'] },
      { field: 'disabled', operators: ['eq'] },
      { field: 'locked', operators: ['eq'] }
    ]
  },

  // Access Requests
  'access-requests': {
    endpoint: '/access-requests',
    filters: [
      { field: 'accountActivityItemId', operators: ['eq'] },
      { field: 'requestedObjectId', operators: ['eq'] },
      { field: 'requestedObjectName', operators: ['eq', 'sw', 'co'] },
      { field: 'requestedObjectType', operators: ['eq'] },
      { field: 'requestType', operators: ['eq'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] }
    ]
  },

  // Access Request Approvals
  'access-request-approvals': {
    endpoint: '/access-request-approvals',
    filters: [
      { field: 'id', operators: ['eq'] },
      { field: 'requestedFor.id', operators: ['eq'] },
      { field: 'requestedObjectId', operators: ['eq'] },
      { field: 'status', operators: ['eq'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] }
    ]
  },

  // Work Items
  'work-items': {
    endpoint: '/work-items',
    filters: [
      { field: 'id', operators: ['eq'] },
      { field: 'requestedFor.id', operators: ['eq'] },
      { field: 'assignedTo', operators: ['eq'] },
      { field: 'type', operators: ['eq'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] }
    ]
  },

  // Certifications
  'certifications': {
    endpoint: '/certifications',
    filters: [
      { field: 'id', operators: ['eq'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'campaign.id', operators: ['eq'] },
      { field: 'phase', operators: ['eq'] },
      { field: 'completed', operators: ['eq'] },
      { field: 'identitySummary.id', operators: ['eq'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] }
    ]
  },

  // Certification Campaigns
  'certification-campaigns': {
    endpoint: '/certification-campaigns',
    filters: [
      { field: 'id', operators: ['eq'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'status', operators: ['eq'] },
      { field: 'type', operators: ['eq'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] }
    ]
  },

  // Governance Groups
  'governance-groups': {
    endpoint: '/governance-groups',
    filters: [
      { field: 'id', operators: ['eq', 'sw'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'owner.id', operators: ['eq'] }
    ]
  },

  // SOD Policies
  'sod-policies': {
    endpoint: '/sod-policies',
    filters: [
      { field: 'id', operators: ['eq'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'state', operators: ['eq'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] }
    ]
  },

  // SOD Violations
  'sod-violations': {
    endpoint: '/sod-violations',
    filters: [
      { field: 'policyId', operators: ['eq'] },
      { field: 'identityId', operators: ['eq'] },
      { field: 'state', operators: ['eq'] }
    ]
  },

  // Workflows
  'workflows': {
    endpoint: '/workflows',
    filters: [
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'enabled', operators: ['eq'] }
    ]
  },

  // Segments
  'segments': {
    endpoint: '/segments',
    filters: [
      { field: 'id', operators: ['eq'] },
      { field: 'name', operators: ['eq', 'sw', 'co'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] },
      { field: 'modified', operators: ['eq', 'ge', 'le', 'gt', 'lt'] }
    ]
  },

  // Connectors
  'connectors': {
    endpoint: '/connectors',
    filters: [
      { field: 'name', operators: ['eq', 'sw'] },
      { field: 'type', operators: ['eq'] },
      { field: 'scriptName', operators: ['eq', 'sw'] }
    ]
  },

  // Account Activities (events/audit)
  'account-activities': {
    endpoint: '/account-activities',
    filters: [
      { field: 'type', operators: ['eq'] },
      { field: 'action', operators: ['eq'] },
      { field: 'sourceId', operators: ['eq'] },
      { field: 'created', operators: ['eq', 'ge', 'le', 'gt', 'lt'] }
    ]
  }
};

/**
 * Validate if a filter is supported for a given endpoint
 */
export function validateFilter(endpoint: string, field: string, operator: string): { 
  valid: boolean; 
  error?: string;
  suggestion?: string;
} {
  const config = ENDPOINT_FILTER_SUPPORT[endpoint];
  
  if (!config) {
    return { 
      valid: false, 
      error: `Unknown endpoint: ${endpoint}. Filtering support not documented.` 
    };
  }

  const filterCap = config.filters.find(f => {
    // Support wildcard attributes like attributes.{name}
    if (f.field.includes('{name}')) {
      const pattern = f.field.replace('{name}', '.*');
      return new RegExp(`^${pattern}$`).test(field);
    }
    return f.field === field;
  });

  if (!filterCap) {
    const availableFields = config.filters.map(f => f.field).join(', ');
    return { 
      valid: false, 
      error: `Field '${field}' is not filterable on ${endpoint}. Available fields: ${availableFields}` 
    };
  }

  if (!filterCap.operators.includes(operator)) {
    const suggestion = getSuggestedOperator(operator, filterCap.operators);
    return { 
      valid: false, 
      error: `Operator '${operator}' not supported for '${field}' on ${endpoint}. Supported: ${filterCap.operators.join(', ')}`,
      suggestion
    };
  }

  return { valid: true };
}

/**
 * Suggest alternative operator when requested one is not supported
 */
function getSuggestedOperator(requested: string, available: string[]): string | undefined {
  // If they wanted 'co' (contains) but only 'sw' (starts with) available
  if (requested === 'co' && available.includes('sw')) {
    return `Use 'sw' (starts with) instead of 'co' (contains)`;
  }
  
  // If they wanted 'co' but only 'eq' available
  if (requested === 'co' && available.includes('eq')) {
    return `Use 'eq' (equals) for exact match instead of 'co' (contains)`;
  }

  return undefined;
}

/**
 * Get filter documentation for an endpoint to help AI generate correct queries
 */
export function getFilterDocumentation(endpoint: string): string {
  const config = ENDPOINT_FILTER_SUPPORT[endpoint];
  
  if (!config) {
    return `No filter documentation available for ${endpoint}`;
  }

  let doc = `FILTER SUPPORT FOR /${endpoint}:\n\n`;
  
  if (config.notes) {
    doc += `⚠️  ${config.notes}\n\n`;
  }

  doc += `Available Filters:\n`;
  config.filters.forEach(f => {
    doc += `  - ${f.field}: ${f.operators.join(', ')}\n`;
  });

  doc += `\nExamples:\n`;
  
  // Generate examples based on available operators
  const nameFilter = config.filters.find(f => f.field === 'name');
  if (nameFilter) {
    if (nameFilter.operators.includes('eq')) {
      doc += `  - name eq "Exact Name"\n`;
    }
    if (nameFilter.operators.includes('sw')) {
      doc += `  - name sw "Prefix"\n`;
    }
    if (nameFilter.operators.includes('co')) {
      doc += `  - name co "Partial"\n`;
    }
  }

  return doc;
}

/**
 * Auto-correct a filter to use supported operators
 */
export function correctFilter(endpoint: string, filterString: string): {
  corrected: string;
  wasModified: boolean;
  changes: string[];
} {
  const changes: string[] = [];
  let corrected = filterString;
  let wasModified = false;

  // Parse filter (simple regex-based for common cases)
  // Format: "field operator value" or "field operator \"value\""
  const filterPattern = /(\S+)\s+(eq|co|sw|ge|le|gt|lt|ne)\s+(".*?"|[^\s]+)/g;
  
  corrected = filterString.replace(filterPattern, (match, field, operator, value) => {
    const validation = validateFilter(endpoint, field, operator);
    
    if (!validation.valid && validation.suggestion) {
      wasModified = true;
      
      // Try to auto-correct
      const config = ENDPOINT_FILTER_SUPPORT[endpoint];
      const filterCap = config?.filters.find(f => f.field === field);
      
      if (filterCap) {
        // If co not supported but sw is, use sw
        if (operator === 'co' && filterCap.operators.includes('sw')) {
          changes.push(`Changed '${field} co' to '${field} sw' (contains not supported, using starts-with)`);
          return `${field} sw ${value}`;
        }
        // If co not supported but eq is, use eq
        else if (operator === 'co' && filterCap.operators.includes('eq')) {
          changes.push(`Changed '${field} co' to '${field} eq' (contains not supported, using exact match)`);
          return `${field} eq ${value}`;
        }
      }
    }
    
    return match;
  });

  return { corrected, wasModified, changes };
}
