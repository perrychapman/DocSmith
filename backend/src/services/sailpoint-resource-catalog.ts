// backend/src/services/sailpoint-resource-catalog.ts
// Comprehensive SailPoint V3 API resource catalog
// Helps AI understand what's queryable and how

export interface ResourceInfo {
  endpoint: string;
  displayName: string;
  description: string;
  supportsCount: boolean;
  supportsSearch: boolean;
  supportsGet: boolean;
  commonFilters: string[];
  keyFields: string[];
  useCases: string[];
  relatedTo?: string[];
}

/**
 * Comprehensive catalog of all queryable SailPoint resources
 * Organized by functional category for easy discovery
 */
export const SAILPOINT_RESOURCE_CATALOG: Record<string, ResourceInfo> = {
  // === CORE IDENTITY & ACCESS ===
  'identities': {
    endpoint: 'identities',
    displayName: 'Identities',
    description: 'Users and people in the system',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'email', 'alias', 'inactive', 'manager.id', 'source.id'],
    keyFields: ['id', 'name', 'email', 'manager', 'accounts', 'attributes', 'inactive'],
    useCases: [
      'User searches and inventories',
      'Manager hierarchy analysis',
      'Department breakdowns',
      'Inactive user detection',
      'Identity attribute analysis'
    ],
    relatedTo: ['accounts', 'access-requests', 'certifications']
  },

  'accounts': {
    endpoint: 'accounts',
    displayName: 'Accounts',
    description: 'System accounts belonging to identities',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['identityId', 'sourceId', 'disabled', 'locked', 'uncorrelated'],
    keyFields: ['id', 'name', 'nativeIdentity', 'identityId', 'sourceId', 'disabled', 'locked'],
    useCases: [
      'Account inventories by source',
      'Orphaned account detection',
      'Disabled account analysis',
      'Account correlation status',
      'Multi-account identity analysis'
    ],
    relatedTo: ['identities', 'sources', 'entitlements']
  },

  'entitlements': {
    endpoint: 'entitlements',
    displayName: 'Entitlements',
    description: 'Permissions and groups in source systems',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['source.id', 'privileged', 'requestable', 'name', 'value'],
    keyFields: ['id', 'name', 'value', 'attribute', 'source', 'privileged', 'requestable'],
    useCases: [
      'Permission inventories',
      'Privileged access reviews',
      'Entitlement analysis by source',
      'Requestable entitlement catalogs',
      'Access type breakdown'
    ],
    relatedTo: ['sources', 'access-profiles', 'roles']
  },

  'roles': {
    endpoint: 'roles',
    displayName: 'Roles',
    description: 'Business roles with collections of access',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'owner.id', 'requestable', 'source.id'],
    keyFields: ['id', 'name', 'owner', 'source', 'accessProfiles', 'membership', 'requestable'],
    useCases: [
      'Role inventories',
      'Role-to-source mapping',
      'Access profile relationships',
      'Role ownership analysis',
      'Requestable role catalogs'
    ],
    relatedTo: ['access-profiles', 'identities']
  },

  'access-profiles': {
    endpoint: 'access-profiles',
    displayName: 'Access Profiles',
    description: 'Groups of entitlements packaged together',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['source.id', 'owner.id', 'requestable', 'name'],
    keyFields: ['id', 'name', 'source', 'entitlements', 'owner', 'requestable'],
    useCases: [
      'Access packaging analysis',
      'Entitlement groupings',
      'Source-based access profiles',
      'Owner responsibility tracking',
      'Access catalog management'
    ],
    relatedTo: ['entitlements', 'roles', 'sources']
  },

  'sources': {
    endpoint: 'sources',
    displayName: 'Sources',
    description: 'Connected systems and applications',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'healthy', 'status', 'connectionType', 'owner.id'],
    keyFields: ['id', 'name', 'type', 'owner', 'healthy', 'status', 'connectorAttributes'],
    useCases: [
      'System inventories',
      'Connector health monitoring',
      'Integration analysis',
      'Source ownership tracking',
      'Connection type breakdown'
    ],
    relatedTo: ['accounts', 'entitlements', 'access-profiles', 'connectors']
  },

  // === REQUESTS & APPROVALS ===
  'access-requests': {
    endpoint: 'access-requests',
    displayName: 'Access Requests',
    description: 'Requests for access to roles, profiles, or entitlements',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['requestType', 'requestedObjectId', 'requestedObjectType', 'created'],
    keyFields: ['id', 'requestedFor', 'requestedItems', 'requestType', 'state', 'priority'],
    useCases: [
      'Access request tracking',
      'Request volume analysis',
      'Pending request queues',
      'Request type breakdown',
      'Approval workflow tracking'
    ],
    relatedTo: ['access-request-approvals', 'identities']
  },

  'access-request-approvals': {
    endpoint: 'access-request-approvals',
    displayName: 'Access Request Approvals',
    description: 'Pending approval tasks for access requests',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['status', 'requestedFor.id', 'requestedObjectId', 'created'],
    keyFields: ['id', 'requestedFor', 'requestedObjectId', 'state', 'approvalSummary'],
    useCases: [
      'Approval queue management',
      'Pending approval tracking',
      'Approver workload analysis',
      'Decision tracking',
      'Approval bottleneck detection'
    ],
    relatedTo: ['access-requests', 'identities', 'work-items']
  },

  'work-items': {
    endpoint: 'work-items',
    displayName: 'Work Items',
    description: 'Tasks assigned to users for action',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['type', 'state', 'assignedTo', 'created'],
    keyFields: ['id', 'type', 'state', 'requesterName', 'name', 'completionStatus'],
    useCases: [
      'Task queue management',
      'Workflow tracking',
      'Workload distribution analysis',
      'Completion status tracking',
      'Type-based work item analysis'
    ],
    relatedTo: ['access-request-approvals', 'certifications']
  },

  // === GOVERNANCE & COMPLIANCE ===
  'certifications': {
    endpoint: 'certifications',
    displayName: 'Certifications',
    description: 'Individual access review tasks in campaigns',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['campaign.id', 'phase', 'completed', 'identitySummary.id'],
    keyFields: ['id', 'name', 'campaign', 'phase', 'completed', 'decisionsMade', 'reviewer'],
    useCases: [
      'Certification progress tracking',
      'Review completion analysis',
      'Campaign participation',
      'Decision tracking',
      'Reviewer workload analysis'
    ],
    relatedTo: ['certification-campaigns', 'identities']
  },

  'certification-campaigns': {
    endpoint: 'certification-campaigns',
    displayName: 'Certification Campaigns',
    description: 'Access review campaigns',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['status', 'type', 'name', 'created'],
    keyFields: ['id', 'name', 'type', 'status', 'deadline', 'certificationsCount'],
    useCases: [
      'Campaign management',
      'Compliance tracking',
      'Campaign type analysis',
      'Status monitoring',
      'Campaign scheduling'
    ],
    relatedTo: ['certifications']
  },

  'governance-groups': {
    endpoint: 'governance-groups',
    displayName: 'Governance Groups',
    description: 'Groups used in governance workflows',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'owner.id'],
    keyFields: ['id', 'name', 'owner', 'memberCount', 'members'],
    useCases: [
      'Governance organization',
      'Group membership tracking',
      'Owner responsibility mapping',
      'Group size analysis'
    ],
    relatedTo: ['identities']
  },

  'sod-policies': {
    endpoint: 'sod-policies',
    displayName: 'SOD Policies',
    description: 'Segregation of Duties policies',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'state', 'created'],
    keyFields: ['id', 'name', 'state', 'conflictingAccessCriteria', 'violationOwner'],
    useCases: [
      'SOD policy management',
      'Conflict detection rules',
      'Policy state tracking',
      'Violation owner assignment'
    ],
    relatedTo: ['sod-violations']
  },

  'sod-violations': {
    endpoint: 'sod-violations',
    displayName: 'SOD Violations',
    description: 'Detected segregation of duties conflicts',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['policyId', 'identityId', 'state'],
    keyFields: ['id', 'policyId', 'policyName', 'identityId', 'state', 'conflictingAccessDetails'],
    useCases: [
      'Violation tracking',
      'Remediation monitoring',
      'Policy violation analysis',
      'Identity risk assessment'
    ],
    relatedTo: ['sod-policies', 'identities']
  },

  'segments': {
    endpoint: 'segments',
    displayName: 'Segments',
    description: 'Identity segments for targeting and visibility',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'created'],
    keyFields: ['id', 'name', 'owner', 'visibilityCriteria', 'active'],
    useCases: [
      'Segment analysis',
      'Targeting rules',
      'Visibility configuration',
      'Segment membership'
    ],
    relatedTo: ['identities']
  },

  // === WORKFLOWS & AUTOMATION ===
  'workflows': {
    endpoint: 'workflows',
    displayName: 'Workflows',
    description: 'Automation workflows and orchestration',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'enabled'],
    keyFields: ['id', 'name', 'enabled', 'executionCount', 'owner', 'trigger'],
    useCases: [
      'Workflow management',
      'Automation tracking',
      'Execution analysis',
      'Trigger configuration review'
    ],
    relatedTo: []
  },

  'transforms': {
    endpoint: 'transforms',
    displayName: 'Transforms',
    description: 'Data transformation rules',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'internal'], // LIMITED: only 'eq' and 'sw' for name!
    keyFields: ['id', 'name', 'type', 'attributes', 'internal'],
    useCases: [
      'Transform management',
      'Data mapping configuration',
      'Custom vs system transforms',
      'Transform type analysis'
    ],
    relatedTo: []
  },

  // === TECHNICAL & AUDIT ===
  'connectors': {
    endpoint: 'connectors',
    displayName: 'Connectors',
    description: 'Connector definitions and capabilities',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['name', 'type', 'scriptName'],
    keyFields: ['id', 'name', 'type', 'scriptName', 'features', 'directConnect'],
    useCases: [
      'Connector inventory',
      'Capability analysis',
      'Connector type breakdown',
      'Feature availability'
    ],
    relatedTo: ['sources']
  },

  'account-activities': {
    endpoint: 'account-activities',
    displayName: 'Account Activities',
    description: 'Audit events and account activity logs',
    supportsCount: true,
    supportsSearch: true,
    supportsGet: true,
    commonFilters: ['type', 'action', 'sourceId', 'created'],
    keyFields: ['id', 'type', 'action', 'sourceId', 'targetId', 'actorId', 'created'],
    useCases: [
      'Audit trails',
      'Event analysis',
      'Activity monitoring',
      'Troubleshooting',
      'Compliance reporting'
    ],
    relatedTo: ['sources', 'accounts', 'identities']
  }
};

/**
 * Get resource information by endpoint name
 */
export function getResourceInfo(endpoint: string): ResourceInfo | undefined {
  return SAILPOINT_RESOURCE_CATALOG[endpoint];
}

/**
 * Get all resources in a category
 */
export function getResourcesByCategory(category: 'identity' | 'governance' | 'workflow' | 'technical'): ResourceInfo[] {
  const categoryMap = {
    identity: ['identities', 'accounts', 'entitlements', 'roles', 'access-profiles', 'sources'],
    governance: ['certifications', 'certification-campaigns', 'governance-groups', 'sod-policies', 'sod-violations', 'segments'],
    workflow: ['workflows', 'transforms', 'access-requests', 'access-request-approvals', 'work-items'],
    technical: ['connectors', 'account-activities']
  };

  return categoryMap[category]
    .map(endpoint => SAILPOINT_RESOURCE_CATALOG[endpoint])
    .filter(Boolean);
}

/**
 * Find resources by use case
 */
export function findResourcesByUseCase(useCase: string): ResourceInfo[] {
  const lowerUseCase = useCase.toLowerCase();
  return Object.values(SAILPOINT_RESOURCE_CATALOG)
    .filter(resource => 
      resource.useCases.some(uc => uc.toLowerCase().includes(lowerUseCase))
    );
}

/**
 * Generate AI-friendly resource documentation
 */
export function generateResourceGuide(endpoint: string): string {
  const info = getResourceInfo(endpoint);
  if (!info) return `Resource ${endpoint} not found in catalog`;

  let guide = `=== ${info.displayName.toUpperCase()} ===\n\n`;
  guide += `${info.description}\n\n`;
  guide += `Endpoint: /${info.endpoint}\n`;
  guide += `Actions: `;
  if (info.supportsCount) guide += 'count_' + info.endpoint + ' ';
  if (info.supportsSearch) guide += 'search_' + info.endpoint + ' ';
  if (info.supportsGet) guide += 'get_' + info.endpoint;
  guide += '\n\n';

  guide += `Key Fields: ${info.keyFields.join(', ')}\n\n`;
  guide += `Common Filters: ${info.commonFilters.join(', ')}\n\n`;

  guide += `Use Cases:\n`;
  info.useCases.forEach(uc => {
    guide += `  - ${uc}\n`;
  });

  if (info.relatedTo && info.relatedTo.length > 0) {
    guide += `\nRelated Resources: ${info.relatedTo.join(', ')}\n`;
  }

  return guide;
}
