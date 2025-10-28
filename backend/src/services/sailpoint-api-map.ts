// Backend SailPoint API categories and endpoints map
// Generated from IdentityNow Beta API Postman Collection

export const SAILPOINT_API_CATEGORIES = {
  // Identity & Access Management
  'identities': {
    list: '/identities',
    get: '/identities/{id}',
    delete: '/identities/{id}',
    synchronizeAttributes: '/identities/synchronize-attributes',
  },
  'accounts': {
    list: '/accounts',
    get: '/accounts/{id}',
    update: '/accounts/{id}',
    delete: '/accounts/{id}',
    disable: '/accounts/{id}/disable',
    enable: '/accounts/{id}/enable',
    unlock: '/accounts/{id}/unlock',
    reload: '/accounts/{id}/reload',
  },
  'entitlements': {
    list: '/entitlements',
    get: '/entitlements/{id}',
    update: '/entitlements/{id}',
    reset: '/entitlements/{id}/reset',
  },
  
  // Access Requests & Approvals
  'accessProfiles': {
    list: '/access-profiles',
    get: '/access-profiles/{id}',
    create: '/access-profiles',
    update: '/access-profiles/{id}',
    delete: '/access-profiles/{id}',
  },
  'accessRequests': {
    list: '/access-requests',
    create: '/access-requests',
    cancel: '/access-requests/cancel',
    get: '/access-requests/{id}',
  },
  'accessRequestApprovals': {
    list: '/access-request-approvals',
    get: '/access-request-approvals/{id}',
    approve: '/access-request-approvals/{id}/approve',
    reject: '/access-request-approvals/{id}/reject',
    forward: '/access-request-approvals/{id}/forward',
  },
  
  // Roles & Role Mining
  'roles': {
    list: '/roles',
    get: '/roles/{id}',
    create: '/roles',
    update: '/roles/{id}',
    delete: '/roles/{id}',
  },
  'roleInsights': {
    list: '/role-insights',
    get: '/role-insights/{id}',
  },
  'iaiRoleMining': {
    getSessions: '/role-mining-sessions',
    getSession: '/role-mining-sessions/{id}',
    createSession: '/role-mining-sessions',
  },
  
  // Sources & Connectors
  'sources': {
    list: '/sources',
    get: '/sources/{id}',
    create: '/sources',
    update: '/sources/{id}',
    delete: '/sources/{id}',
    ping: '/sources/{id}/ping',
    testConnection: '/sources/{id}/test-connection',
  },
  'connectors': {
    list: '/connectors',
    get: '/connectors/{id}',
    update: '/connectors/{id}',
    delete: '/connectors/{id}',
  },
  
  // Certifications & Campaigns
  'certificationCampaigns': {
    list: '/certification-campaigns',
    get: '/certification-campaigns/{id}',
    create: '/certification-campaigns',
    update: '/certification-campaigns/{id}',
    delete: '/certification-campaigns/{id}',
    activate: '/certification-campaigns/{id}/activate',
    complete: '/certification-campaigns/{id}/complete',
  },
  'certifications': {
    list: '/certifications',
    get: '/certifications/{id}',
    reviewers: '/certifications/{id}/reviewers',
    decisions: '/certifications/{id}/decisions',
    sign: '/certifications/{id}/sign-off',
  },
  
  // Governance & Compliance
  'governanceGroups': {
    list: '/governance-groups',
    get: '/governance-groups/{id}',
    create: '/governance-groups',
    update: '/governance-groups/{id}',
    delete: '/governance-groups/{id}',
  },
  'sodPolicies': {
    list: '/sod-policies',
    get: '/sod-policies/{id}',
    create: '/sod-policies',
    update: '/sod-policies/{id}',
    delete: '/sod-policies/{id}',
  },
  'sodViolations': {
    list: '/sod-violations',
    get: '/sod-violations/{id}',
  },
  'segments': {
    list: '/segments',
    get: '/segments/{id}',
    create: '/segments',
    update: '/segments/{id}',
    delete: '/segments/{id}',
  },
  
  // Workflows & Triggers
  'workflows': {
    list: '/workflows',
    get: '/workflows/{id}',
    create: '/workflows',
    update: '/workflows/{id}',
    delete: '/workflows/{id}',
    test: '/workflows/{id}/test',
  },
  'triggers': {
    list: '/triggers',
    listSubscriptions: '/triggers/{id}/subscriptions',
    createSubscription: '/triggers/{id}/subscriptions',
    updateSubscription: '/triggers/{id}/subscriptions/{subscriptionId}',
    deleteSubscription: '/triggers/{id}/subscriptions/{subscriptionId}',
    testSubscription: '/triggers/{id}/subscriptions/{subscriptionId}/test',
  },
  
  // Transforms
  'transforms': {
    list: '/transforms',
    get: '/transforms/{id}',
    create: '/transforms',
    update: '/transforms/{id}',
    delete: '/transforms/{id}',
  },
  
  // Password Management
  'passwordConfiguration': {
    get: '/password-org-config',
    update: '/password-org-config',
  },
  'passwordManagement': {
    setPassword: '/set-password',
    changePassword: '/set-password/{identityId}/set-password',
    generatePassword: '/generate-password',
  },
  'passwordSyncGroups': {
    list: '/password-sync-groups',
    get: '/password-sync-groups/{id}',
    create: '/password-sync-groups',
    update: '/password-sync-groups/{id}',
    delete: '/password-sync-groups/{id}',
  },
  
  // Identity Profiles & Lifecycle
  'identityProfiles': {
    list: '/identity-profiles',
    get: '/identity-profiles/{id}',
    create: '/identity-profiles',
    update: '/identity-profiles/{id}',
    delete: '/identity-profiles/{id}',
    generatePreview: '/identity-profiles/{id}/generate-preview',
  },
  'lifecycleStates': {
    list: '/identity-profiles/{identityProfileId}/lifecycle-states',
    get: '/identity-profiles/{identityProfileId}/lifecycle-states/{id}',
    create: '/identity-profiles/{identityProfileId}/lifecycle-states',
    update: '/identity-profiles/{identityProfileId}/lifecycle-states/{id}',
    delete: '/identity-profiles/{identityProfileId}/lifecycle-states/{id}',
  },
  
  // IAI (Identity AI)
  'iaiRecommendations': {
    getAccessRecommendations: '/recommendations/access-request',
    ignoreRecommendation: '/recommendations/access-request/{id}/ignore',
  },
  'iaiOutliers': {
    list: '/outliers',
    get: '/outliers/{id}',
    ignore: '/outliers/{id}/ignore',
    unignore: '/outliers/{id}/unignore',
  },
  'iaiPeerGroups': {
    list: '/peer-group-strategies',
    get: '/peer-group-strategies/{id}',
  },
  
  // Work Items & Tasks
  'workItems': {
    list: '/work-items',
    get: '/work-items/{id}',
    complete: '/work-items/{id}',
    approve: '/work-items/{id}/approve',
    reject: '/work-items/{id}/reject',
    forward: '/work-items/{id}/forward',
    summary: '/work-items/summary',
    count: '/work-items/count',
  },
  'taskManagement': {
    list: '/task-status',
    get: '/task-status/{id}',
    cancel: '/task-status/{id}/cancel',
  },
  
  // Account Activities & Aggregations
  'accountActivities': {
    list: '/account-activities',
    get: '/account-activities/{id}',
  },
  'accountAggregations': {
    list: '/account-aggregations',
    get: '/account-aggregations/{id}',
  },
  
  // Service Desk Integration
  'serviceDeskIntegration': {
    list: '/service-desk-integrations',
    get: '/service-desk-integrations/{id}',
    create: '/service-desk-integrations',
    update: '/service-desk-integrations/{id}',
    delete: '/service-desk-integrations/{id}',
  },
  
  // MFA
  'mfaConfiguration': {
    get: '/mfa/{method}/config',
    update: '/mfa/{method}/config',
    test: '/mfa/{method}/test',
  },
  
  // OAuth & Authentication
  'oauthClients': {
    list: '/oauth-clients',
    get: '/oauth-clients/{id}',
    create: '/oauth-clients',
    update: '/oauth-clients/{id}',
    delete: '/oauth-clients/{id}',
  },
  'personalAccessTokens': {
    list: '/personal-access-tokens',
    create: '/personal-access-tokens',
    delete: '/personal-access-tokens/{id}',
  },
  
  // Notifications & Templates
  'notifications': {
    listTemplates: '/notification-templates',
    getTemplate: '/notification-templates/{id}',
    createTemplate: '/notification-templates',
    updateTemplate: '/notification-templates/{id}',
  },
  
  // Custom Forms
  'customForms': {
    list: '/custom-forms',
    get: '/custom-forms/{id}',
    create: '/custom-forms',
    update: '/custom-forms/{id}',
    delete: '/custom-forms/{id}',
  },
  
  // Non-Employee Lifecycle
  'nonEmployeeLifecycle': {
    listRecords: '/non-employee-records',
    getRecord: '/non-employee-records/{id}',
    approveRequest: '/non-employee-approvals/{id}/approve',
    rejectRequest: '/non-employee-approvals/{id}/reject',
  },
  
  // Managed Clusters & Clients
  'managedClusters': {
    list: '/managed-clusters',
    get: '/managed-clusters/{id}',
    create: '/managed-clusters',
    update: '/managed-clusters/{id}',
    delete: '/managed-clusters/{id}',
  },
  'managedClients': {
    list: '/managed-clients',
    get: '/managed-clients/{id}',
    create: '/managed-clients',
    update: '/managed-clients/{id}',
    delete: '/managed-clients/{id}',
  },
  
  // Configuration & Admin
  'orgConfig': {
    get: '/org-config',
    update: '/org-config',
  },
  'spConfig': {
    export: '/sp-config/export',
    import: '/sp-config/import',
    download: '/sp-config/export/{id}/download',
  },
  'searchAttributeConfig': {
    get: '/accounts/search-attribute-config',
    update: '/accounts/search-attribute-config',
  },
  
  // Identity Attributes
  'identityAttributes': {
    list: '/identity-attributes',
    get: '/identity-attributes/{id}',
    create: '/identity-attributes',
    update: '/identity-attributes/{id}',
    delete: '/identity-attributes/{id}',
  },
  
  // Tagged Objects
  'taggedObjects': {
    list: '/tagged-objects',
    tag: '/tagged-objects',
    untag: '/tagged-objects/bulk-remove',
  },
  
  // Requestable Objects
  'requestableObjects': {
    list: '/requestable-objects',
  },
  
  // Public Identities
  'publicIdentities': {
    getConfig: '/public-identities-config',
    updateConfig: '/public-identities-config',
  },
  
  // Connector Rules
  'connectorRules': {
    list: '/connector-rules',
    get: '/connector-rules/{id}',
    create: '/connector-rules',
    update: '/connector-rules/{id}',
    delete: '/connector-rules/{id}',
    validate: '/connector-rules/validate',
  },
  
  // Identity History
  'identityHistory': {
    list: '/historical-identities',
    get: '/historical-identities/{id}',
    compare: '/historical-identities/compare',
  },
  
  // Work Reassignment
  'workReassignment': {
    list: '/work-items/reassign',
    reassign: '/work-items/bulk-reassign',
  },
  
  // Source Usages
  'sourceUsages': {
    get: '/source-usages/{sourceId}',
  },
  
  // Account Usages
  'accountUsages': {
    get: '/account-usages/{accountId}',
  },
};

// Export a flattened API map for the query service
// Each category has an array of endpoint objects with method, path, and description
export const SAILPOINT_API_MAP: Record<string, Array<{ method: string; path: string; description: string }>> = {
  'Identities': [
    { method: 'GET', path: '/identities', description: 'List identities' },
    { method: 'GET', path: '/identities/{id}', description: 'Get identity by ID' },
    { method: 'DELETE', path: '/identities/{id}', description: 'Delete identity' },
    { method: 'POST', path: '/identities/synchronize-attributes', description: 'Synchronize identity attributes' },
  ],
  'Accounts': [
    { method: 'GET', path: '/accounts', description: 'List accounts' },
    { method: 'GET', path: '/accounts/{id}', description: 'Get account by ID' },
    { method: 'PATCH', path: '/accounts/{id}', description: 'Update account' },
    { method: 'DELETE', path: '/accounts/{id}', description: 'Delete account' },
    { method: 'POST', path: '/accounts/{id}/disable', description: 'Disable account' },
    { method: 'POST', path: '/accounts/{id}/enable', description: 'Enable account' },
    { method: 'POST', path: '/accounts/{id}/unlock', description: 'Unlock account' },
    { method: 'POST', path: '/accounts/{id}/reload', description: 'Reload account' },
  ],
  'Roles': [
    { method: 'GET', path: '/roles', description: 'List roles' },
    { method: 'GET', path: '/roles/{id}', description: 'Get role by ID' },
    { method: 'POST', path: '/roles', description: 'Create role' },
    { method: 'PATCH', path: '/roles/{id}', description: 'Update role' },
    { method: 'DELETE', path: '/roles/{id}', description: 'Delete role' },
  ],
  'Access Profiles': [
    { method: 'GET', path: '/access-profiles', description: 'List access profiles' },
    { method: 'GET', path: '/access-profiles/{id}', description: 'Get access profile by ID' },
    { method: 'POST', path: '/access-profiles', description: 'Create access profile' },
    { method: 'PATCH', path: '/access-profiles/{id}', description: 'Update access profile' },
    { method: 'DELETE', path: '/access-profiles/{id}', description: 'Delete access profile' },
  ],
  'Access Requests': [
    { method: 'GET', path: '/access-requests', description: 'List access requests' },
    { method: 'POST', path: '/access-requests', description: 'Create access request' },
    { method: 'POST', path: '/access-requests/cancel', description: 'Cancel access requests' },
    { method: 'GET', path: '/access-requests/{id}', description: 'Get access request by ID' },
  ],
  'Sources': [
    { method: 'GET', path: '/sources', description: 'List sources' },
    { method: 'GET', path: '/sources/{id}', description: 'Get source by ID' },
    { method: 'POST', path: '/sources', description: 'Create source' },
    { method: 'PATCH', path: '/sources/{id}', description: 'Update source' },
    { method: 'DELETE', path: '/sources/{id}', description: 'Delete source' },
  ],
  'Entitlements': [
    { method: 'GET', path: '/entitlements', description: 'List entitlements' },
    { method: 'GET', path: '/entitlements/{id}', description: 'Get entitlement by ID' },
    { method: 'PATCH', path: '/entitlements/{id}', description: 'Update entitlement' },
  ],
  'Certifications': [
    { method: 'GET', path: '/certifications', description: 'List certifications' },
    { method: 'GET', path: '/certifications/{id}', description: 'Get certification by ID' },
  ],
  'Workflows': [
    { method: 'GET', path: '/workflows', description: 'List workflows' },
    { method: 'GET', path: '/workflows/{id}', description: 'Get workflow by ID' },
    { method: 'POST', path: '/workflows', description: 'Create workflow' },
    { method: 'PATCH', path: '/workflows/{id}', description: 'Update workflow' },
    { method: 'DELETE', path: '/workflows/{id}', description: 'Delete workflow' },
  ],
  'Transforms': [
    { method: 'GET', path: '/transforms', description: 'List transforms' },
    { method: 'GET', path: '/transforms/{id}', description: 'Get transform by ID' },
    { method: 'POST', path: '/transforms', description: 'Create transform' },
    { method: 'PATCH', path: '/transforms/{id}', description: 'Update transform' },
    { method: 'DELETE', path: '/transforms/{id}', description: 'Delete transform' },
  ],
  'Governance Groups': [
    { method: 'GET', path: '/governance-groups', description: 'List governance groups' },
    { method: 'GET', path: '/governance-groups/{id}', description: 'Get governance group by ID' },
    { method: 'POST', path: '/governance-groups', description: 'Create governance group' },
    { method: 'PATCH', path: '/governance-groups/{id}', description: 'Update governance group' },
    { method: 'DELETE', path: '/governance-groups/{id}', description: 'Delete governance group' },
  ],
};
