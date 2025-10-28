// backend/src/services/sailpoint-enhanced.ts
// Enhanced SailPoint service with comprehensive API coverage
import { sailpointRequest, getSailpointConfig, type SailpointEnvironment } from './sailpoint';
import { SAILPOINT_API_CATEGORIES } from './sailpoint-api-map';

/**
 * Generic list function with pagination and filtering
 */
export async function sailpointList<T = any>(
  customerId: number,
  environment: SailpointEnvironment,
  endpoint: string,
  params?: {
    limit?: number;
    offset?: number;
    count?: boolean;
    filters?: string;
    sorters?: string;
    [key: string]: any;
  }
): Promise<T[]> {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  
  const queryParams = new URLSearchParams();
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value));
      }
    });
  }
  
  const url = queryParams.toString() ? `${endpoint}?${queryParams}` : endpoint;
  return sailpointRequest<T[]>(config, url, 'GET');
}

/**
 * Generic get function
 */
export async function sailpointGet<T = any>(
  customerId: number,
  environment: SailpointEnvironment,
  endpoint: string
): Promise<T> {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  
  return sailpointRequest<T>(config, endpoint, 'GET');
}

/**
 * Generic create function
 * SECURITY: This is a direct service function, not chat integration - allow write operations
 */
export async function sailpointCreate<T = any>(
  customerId: number,
  environment: SailpointEnvironment,
  endpoint: string,
  body: any
): Promise<T> {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  
  return sailpointRequest<T>(config, endpoint, 'POST', body, {}, false, false, true);
}

/**
 * Generic update function
 * SECURITY: This is a direct service function, not chat integration - allow write operations
 */
export async function sailpointUpdate<T = any>(
  customerId: number,
  environment: SailpointEnvironment,
  endpoint: string,
  body: any
): Promise<T> {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  
  return sailpointRequest<T>(config, endpoint, 'PATCH', body, {}, false, false, true);
}

/**
 * Generic delete function
 * SECURITY: This is a direct service function, not chat integration - allow write operations
 */
export async function sailpointDelete(
  customerId: number,
  environment: SailpointEnvironment,
  endpoint: string
): Promise<void> {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  
  return sailpointRequest<void>(config, endpoint, 'DELETE', undefined, {}, false, false, true);
}

// ============================================================================
// IDENTITY & ACCESS MANAGEMENT
// ============================================================================

export async function listIdentities(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.identities.list, params);
}

export async function getIdentity(
  customerId: number,
  environment: SailpointEnvironment,
  identityId: string
) {
  return sailpointGet(customerId, environment, `/identities/${identityId}`);
}

export async function listAccounts(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.accounts.list, params);
}

export async function getAccount(
  customerId: number,
  environment: SailpointEnvironment,
  accountId: string
) {
  return sailpointGet(customerId, environment, `/accounts/${accountId}`);
}

export async function disableAccount(
  customerId: number,
  environment: SailpointEnvironment,
  accountId: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/accounts/${accountId}/disable`, 'POST', undefined, {}, false, false, true);
}

export async function enableAccount(
  customerId: number,
  environment: SailpointEnvironment,
  accountId: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/accounts/${accountId}/enable`, 'POST', undefined, {}, false, false, true);
}

export async function unlockAccount(
  customerId: number,
  environment: SailpointEnvironment,
  accountId: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/accounts/${accountId}/unlock`, 'POST', undefined, {}, false, false, true);
}

export async function listEntitlements(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.entitlements.list, params);
}

export async function getEntitlement(
  customerId: number,
  environment: SailpointEnvironment,
  entitlementId: string
) {
  return sailpointGet(customerId, environment, `/entitlements/${entitlementId}`);
}

// ============================================================================
// ACCESS REQUESTS & APPROVALS
// ============================================================================

export async function listAccessProfiles(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.accessProfiles.list, params);
}

export async function getAccessProfile(
  customerId: number,
  environment: SailpointEnvironment,
  accessProfileId: string
) {
  return sailpointGet(customerId, environment, `/access-profiles/${accessProfileId}`);
}

export async function createAccessProfile(
  customerId: number,
  environment: SailpointEnvironment,
  accessProfile: any
) {
  return sailpointCreate(customerId, environment, SAILPOINT_API_CATEGORIES.accessProfiles.create, accessProfile);
}

export async function listAccessRequests(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.accessRequests.list, params);
}

export async function createAccessRequest(
  customerId: number,
  environment: SailpointEnvironment,
  request: any
) {
  return sailpointCreate(customerId, environment, SAILPOINT_API_CATEGORIES.accessRequests.create, request);
}

export async function listAccessRequestApprovals(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.accessRequestApprovals.list, params);
}

export async function approveAccessRequest(
  customerId: number,
  environment: SailpointEnvironment,
  approvalId: string,
  comment?: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/access-request-approvals/${approvalId}/approve`, 'POST', { comment }, {}, false, false, true);
}

export async function rejectAccessRequest(
  customerId: number,
  environment: SailpointEnvironment,
  approvalId: string,
  comment?: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/access-request-approvals/${approvalId}/reject`, 'POST', { comment }, {}, false, false, true);
}

// ============================================================================
// ROLES
// ============================================================================

export async function listRoles(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.roles.list, params);
}

export async function getRole(
  customerId: number,
  environment: SailpointEnvironment,
  roleId: string
) {
  return sailpointGet(customerId, environment, `/roles/${roleId}`);
}

export async function createRole(
  customerId: number,
  environment: SailpointEnvironment,
  role: any
) {
  return sailpointCreate(customerId, environment, SAILPOINT_API_CATEGORIES.roles.create, role);
}

export async function updateRole(
  customerId: number,
  environment: SailpointEnvironment,
  roleId: string,
  role: any
) {
  return sailpointUpdate(customerId, environment, `/roles/${roleId}`, role);
}

export async function deleteRole(
  customerId: number,
  environment: SailpointEnvironment,
  roleId: string
) {
  return sailpointDelete(customerId, environment, `/roles/${roleId}`);
}

// ============================================================================
// SOURCES & CONNECTORS
// ============================================================================

export async function listSources(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.sources.list, params);
}

export async function getSource(
  customerId: number,
  environment: SailpointEnvironment,
  sourceId: string
) {
  return sailpointGet(customerId, environment, `/sources/${sourceId}`);
}

export async function pingSource(
  customerId: number,
  environment: SailpointEnvironment,
  sourceId: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/sources/${sourceId}/ping`, 'POST', undefined, {}, false, false, true);
}

export async function testSourceConnection(
  customerId: number,
  environment: SailpointEnvironment,
  sourceId: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/sources/${sourceId}/test-connection`, 'POST', undefined, {}, false, false, true);
}

export async function listConnectors(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.connectors.list, params);
}

// ============================================================================
// CERTIFICATIONS & CAMPAIGNS
// ============================================================================

export async function listCertificationCampaigns(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.certificationCampaigns.list, params);
}

export async function getCertificationCampaign(
  customerId: number,
  environment: SailpointEnvironment,
  campaignId: string
) {
  return sailpointGet(customerId, environment, `/certification-campaigns/${campaignId}`);
}

export async function createCertificationCampaign(
  customerId: number,
  environment: SailpointEnvironment,
  campaign: any
) {
  return sailpointCreate(customerId, environment, SAILPOINT_API_CATEGORIES.certificationCampaigns.create, campaign);
}

export async function activateCertificationCampaign(
  customerId: number,
  environment: SailpointEnvironment,
  campaignId: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/certification-campaigns/${campaignId}/activate`, 'POST', undefined, {}, false, false, true);
}

export async function listCertifications(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.certifications.list, params);
}

// ============================================================================
// WORKFLOWS & TRIGGERS
// ============================================================================

export async function listWorkflows(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.workflows.list, params);
}

export async function getWorkflow(
  customerId: number,
  environment: SailpointEnvironment,
  workflowId: string
) {
  return sailpointGet(customerId, environment, `/workflows/${workflowId}`);
}

export async function createWorkflow(
  customerId: number,
  environment: SailpointEnvironment,
  workflow: any
) {
  return sailpointCreate(customerId, environment, SAILPOINT_API_CATEGORIES.workflows.create, workflow);
}

export async function testWorkflow(
  customerId: number,
  environment: SailpointEnvironment,
  workflowId: string,
  input: any
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/workflows/${workflowId}/test`, 'POST', input, {}, false, false, true);
}

export async function listTriggers(
  customerId: number,
  environment: SailpointEnvironment
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.triggers.list);
}

export async function listTriggerSubscriptions(
  customerId: number,
  environment: SailpointEnvironment,
  triggerId: string
) {
  return sailpointList(customerId, environment, `/triggers/${triggerId}/subscriptions`);
}

// ============================================================================
// TRANSFORMS
// ============================================================================

export async function listTransforms(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.transforms.list, params);
}

export async function getTransform(
  customerId: number,
  environment: SailpointEnvironment,
  transformId: string
) {
  return sailpointGet(customerId, environment, `/transforms/${transformId}`);
}

export async function createTransform(
  customerId: number,
  environment: SailpointEnvironment,
  transform: any
) {
  return sailpointCreate(customerId, environment, SAILPOINT_API_CATEGORIES.transforms.create, transform);
}

// ============================================================================
// GOVERNANCE & SOD
// ============================================================================

export async function listGovernanceGroups(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.governanceGroups.list, params);
}

export async function listSODPolicies(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.sodPolicies.list, params);
}

export async function listSODViolations(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.sodViolations.list, params);
}

export async function listSegments(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.segments.list, params);
}

// ============================================================================
// WORK ITEMS & TASKS
// ============================================================================

export async function listWorkItems(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.workItems.list, params);
}

export async function getWorkItem(
  customerId: number,
  environment: SailpointEnvironment,
  workItemId: string
) {
  return sailpointGet(customerId, environment, `/work-items/${workItemId}`);
}

export async function approveWorkItem(
  customerId: number,
  environment: SailpointEnvironment,
  workItemId: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/work-items/${workItemId}/approve`, 'POST', undefined, {}, false, false, true);
}

export async function rejectWorkItem(
  customerId: number,
  environment: SailpointEnvironment,
  workItemId: string
) {
  const config = await getSailpointConfig(customerId, environment);
  if (!config) throw new Error('Configuration not found');
  // SECURITY: This is a direct service function, not chat integration - allow write operations
  return sailpointRequest(config, `/work-items/${workItemId}/reject`, 'POST', undefined, {}, false, false, true);
}

export async function getWorkItemsSummary(
  customerId: number,
  environment: SailpointEnvironment
) {
  return sailpointGet(customerId, environment, SAILPOINT_API_CATEGORIES.workItems.summary);
}

export async function listTasks(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.taskManagement.list, params);
}

export async function getTaskStatus(
  customerId: number,
  environment: SailpointEnvironment,
  taskId: string
) {
  return sailpointGet(customerId, environment, `/task-status/${taskId}`);
}

// ============================================================================
// IDENTITY PROFILES & LIFECYCLE
// ============================================================================

export async function listIdentityProfiles(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.identityProfiles.list, params);
}

export async function getIdentityProfile(
  customerId: number,
  environment: SailpointEnvironment,
  profileId: string
) {
  return sailpointGet(customerId, environment, `/identity-profiles/${profileId}`);
}

export async function listLifecycleStates(
  customerId: number,
  environment: SailpointEnvironment,
  identityProfileId: string
) {
  return sailpointList(customerId, environment, `/identity-profiles/${identityProfileId}/lifecycle-states`);
}

// ============================================================================
// ACCOUNT ACTIVITIES
// ============================================================================

export async function listAccountActivities(
  customerId: number,
  environment: SailpointEnvironment,
  params?: { limit?: number; offset?: number; filters?: string; sorters?: string }
) {
  return sailpointList(customerId, environment, SAILPOINT_API_CATEGORIES.accountActivities.list, params);
}

export async function getAccountActivity(
  customerId: number,
  environment: SailpointEnvironment,
  activityId: string
) {
  return sailpointGet(customerId, environment, `/account-activities/${activityId}`);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export async function exportSPConfig(
  customerId: number,
  environment: SailpointEnvironment,
  options?: any
) {
  return sailpointCreate(customerId, environment, SAILPOINT_API_CATEGORIES.spConfig.export, options);
}

export async function importSPConfig(
  customerId: number,
  environment: SailpointEnvironment,
  config: any
) {
  return sailpointCreate(customerId, environment, SAILPOINT_API_CATEGORIES.spConfig.import, config);
}

export async function getOrgConfig(
  customerId: number,
  environment: SailpointEnvironment
) {
  return sailpointGet(customerId, environment, SAILPOINT_API_CATEGORIES.orgConfig.get);
}

export async function updateOrgConfig(
  customerId: number,
  environment: SailpointEnvironment,
  config: any
) {
  return sailpointUpdate(customerId, environment, SAILPOINT_API_CATEGORIES.orgConfig.update, config);
}
