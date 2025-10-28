// Shared types for SailPoint ISC integration

export type SailpointEnvironment = 'sandbox' | 'prod';

export interface SailpointSource {
  id: string;
  name: string;
  description?: string;
  type: string;
  created?: string;
  modified?: string;
  connectorAttributes?: Record<string, any>;
}

export interface SailpointIdentity {
  id: string;
  name: string;
  displayName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  created?: string;
  modified?: string;
  attributes?: Record<string, any>;
}

export interface SailpointRole {
  id: string;
  name: string;
  description?: string;
  created?: string;
  modified?: string;
  accessProfiles?: Array<{ id: string; name: string }>;
}

export interface SailpointAccessProfile {
  id: string;
  name: string;
  description?: string;
  created?: string;
  modified?: string;
  source?: { id: string; name: string };
  entitlements?: Array<{ id: string; name: string }>;
}

export interface SailpointAccount {
  id: string;
  name: string;
  identityId?: string;
  nativeIdentity?: string;
  sourceId?: string;
  created?: string;
  modified?: string;
  attributes?: Record<string, any>;
}

export interface SailpointEntitlement {
  id: string;
  name: string;
  attribute?: string;
  value?: string;
  description?: string;
  sourceId?: string;
  created?: string;
  modified?: string;
}
