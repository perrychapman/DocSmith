/**
 * SailPoint V3 Search API Integration
 * 
 * This module provides fallback search functionality using the V3 Search API
 * when standard list endpoints fail due to non-queryable fields.
 * 
 * The V3 Search API supports:
 * - Searching across multiple indices (identities, accounts, entitlements, etc.)
 * - Filtering on ANY field including custom attributes
 * - Pagination beyond 10,000 records using searchAfter
 * - Accurate counts via X-Total-Count header
 */

import { sailpointRequest } from './sailpoint.js';
import { logInfo, logError } from '../utils/logger.js';

export interface SearchQuery {
  indices: string[];
  queryType?: 'DSL' | 'SAILPOINT' | 'TEXT' | 'TYPEAHEAD';
  queryVersion?: string;
  query?: {
    query: string;
    fields?: string[];
    timeZone?: string;
    innerHit?: {
      query: string;
      type: string;
    };
  };
  queryDsl?: Record<string, any>;
  textQuery?: {
    terms: string[];
    fields: string[];
    matchAny?: boolean;
    contains?: boolean;
  };
  typeAheadQuery?: {
    query: string;
    field: string;
    nestedType?: string;
    maxExpansions?: number;
    size?: number;
    sort?: string;
    sortByValue?: boolean;
  };
  includeNested?: boolean;
  queryResultFilter?: {
    includes?: string[];
    excludes?: string[];
  };
  aggregationType?: 'DSL' | 'SAILPOINT';
  aggregationsVersion?: string;
  aggregationsDsl?: Record<string, any>;
  aggregations?: Record<string, any>;
  sort?: string[];
  searchAfter?: string[];
  filters?: Record<string, SearchFilter>;
}

export interface SearchFilter {
  type: 'TERMS' | 'RANGE' | 'EXISTS' | 'EQUALS';
  terms?: string[];
  range?: {
    lower?: { value: string; inclusive?: boolean };
    upper?: { value: string; inclusive?: boolean };
  };
  exclude?: boolean;
}

/**
 * Convert standard filter syntax to V3 Search API filters
 * 
 * Examples:
 * - "name eq 'John'" -> { name: { type: 'TERMS', terms: ['John'] } }
 * - "age gt 25" -> { age: { type: 'RANGE', range: { lower: { value: '25', inclusive: false } } } }
 * - "attributes.cloudLifecycleState eq 'inactive'" -> { 'attributes.cloudLifecycleState': { type: 'TERMS', terms: ['inactive'] } }
 */
function convertFilterToSearchFilter(filterString: string): Record<string, SearchFilter> {
  const filters: Record<string, SearchFilter> = {};
  
  if (!filterString) {
    return filters;
  }

  // Split by AND/OR operators (for now, handle simple filters)
  const parts = filterString.split(/\s+and\s+/i);
  
  for (const part of parts) {
    const trimmed = part.trim();
    
    // Match: field eq "value" or field eq 'value'
    const eqMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+eq\s+["']([^"']+)["']$/);
    if (eqMatch) {
      const [, field, value] = eqMatch;
      filters[field] = {
        type: 'TERMS',
        terms: [value]
      };
      continue;
    }

    // Match: field eq value (unquoted)
    const eqUnquotedMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+eq\s+([^"'\s]+)$/);
    if (eqUnquotedMatch) {
      const [, field, value] = eqUnquotedMatch;
      filters[field] = {
        type: 'TERMS',
        terms: [value]
      };
      continue;
    }

    // Match: field in ("value1", "value2")
    const inMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+in\s+\(([^)]+)\)$/);
    if (inMatch) {
      const [, field, valueList] = inMatch;
      const values = valueList.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      filters[field] = {
        type: 'TERMS',
        terms: values
      };
      continue;
    }

    // Match: field gt/ge/lt/le value (range queries)
    const rangeMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+(gt|ge|lt|le)\s+(.+)$/);
    if (rangeMatch) {
      const [, field, operator, value] = rangeMatch;
      const cleanValue = value.replace(/^["']|["']$/g, '');
      
      if (operator === 'gt' || operator === 'ge') {
        filters[field] = {
          type: 'RANGE',
          range: {
            lower: {
              value: cleanValue,
              inclusive: operator === 'ge'
            }
          }
        };
      } else {
        filters[field] = {
          type: 'RANGE',
          range: {
            upper: {
              value: cleanValue,
              inclusive: operator === 'le'
            }
          }
        };
      }
      continue;
    }

    // Match: field sw "value" (starts with - convert to query)
    const swMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+sw\s+["']([^"']+)["']$/);
    if (swMatch) {
      // For 'sw' (starts with), we'll need to use query instead
      // Will be handled in the search query builder
      logInfo(`[SEARCH API] 'sw' operator detected for ${swMatch[1]}, will use query instead of filter`);
      continue;
    }

    // Match: field co "value" (contains - convert to query)
    const coMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+co\s+["']([^"']+)["']$/);
    if (coMatch) {
      // For 'co' (contains), we'll need to use query instead
      logInfo(`[SEARCH API] 'co' operator detected for ${coMatch[1]}, will use query instead of filter`);
      continue;
    }
  }

  return filters;
}

/**
 * Map resource type to search index
 * 
 * Valid indices: accessprofiles, accountactivities, entitlements, events, identities, roles
 */
function getSearchIndex(resourceType: string): string {
  const mapping: Record<string, string> = {
    'identities': 'identities',
    'accounts': 'accountactivities',
    'entitlements': 'entitlements',
    'access-profiles': 'accessprofiles',
    'roles': 'roles',
    'sources': 'identities', // Sources don't have their own index, search identities
    'events': 'events',
    'account-activities': 'accountactivities'
  };

  return mapping[resourceType] || 'identities';
}

/**
 * Execute a search query using the V3 Search API
 */
export async function executeSearchQuery(
  config: any,
  resourceType: string,
  filterString?: string,
  limit: number = 250,
  offset: number = 0,
  count: boolean = false
): Promise<any> {
  logInfo(`[SEARCH API] Executing search for ${resourceType} with filters: ${filterString}`);

  const index = getSearchIndex(resourceType);
  const filters = filterString ? convertFilterToSearchFilter(filterString) : {};

  const searchQuery: SearchQuery = {
    indices: [index],
    queryType: 'SAILPOINT',
    queryVersion: '5.2',
    includeNested: true,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    sort: ['id'] // Always sort by ID for consistent pagination
  };

  // Add pagination - note: limit max is 10000
  const effectiveLimit = Math.min(limit, 10000);
  
  if (offset > 0) {
    // For offset > 0, we'd need to use searchAfter for efficient pagination
    // For now, we'll fetch and skip (less efficient but works)
    logInfo(`[SEARCH API] Offset ${offset} requested, will fetch and skip`);
  }

  const endpoint = `/v3/search?limit=${effectiveLimit}&offset=${offset}&count=${count}`;

  try {
    // V3 Search API uses POST but is a read-only operation (searching)
    // We need to explicitly allow this POST operation
    const result = await sailpointRequest(
      config, 
      endpoint, 
      'POST', 
      searchQuery,
      {},
      false,
      false,
      true // allowWriteOperations - needed for POST even though search is read-only
    );
    
    if (Array.isArray(result)) {
      logInfo(`[SEARCH API] Search returned ${result.length} results`);
      return result;
    }

    logError(`[SEARCH API] Unexpected search result format:`, result);
    return [];
  } catch (error: any) {
    logError(`[SEARCH API] Search failed:`, error);
    throw error;
  }
}

/**
 * Execute a count query using the V3 Search API
 */
export async function executeSearchCount(
  config: any,
  resourceType: string,
  filterString?: string
): Promise<number> {
  logInfo(`[SEARCH API] Executing count for ${resourceType} with filters: ${filterString}`);

  const index = getSearchIndex(resourceType);
  const filters = filterString ? convertFilterToSearchFilter(filterString) : {};

  const searchQuery: SearchQuery = {
    indices: [index],
    queryType: 'SAILPOINT',
    queryVersion: '5.2',
    includeNested: false, // Don't need nested for counts
    filters: Object.keys(filters).length > 0 ? filters : undefined
  };

  const endpoint = `/v3/search?limit=1&count=true`;

  try {
    // V3 Search API uses POST but is a read-only operation (searching)
    // We need to explicitly allow this POST operation and request headers for count
    const result = await sailpointRequest(
      config, 
      endpoint, 
      'POST', 
      searchQuery, 
      {}, 
      false, 
      true, // returnHeaders - need X-Total-Count header
      true  // allowWriteOperations - needed for POST even though search is read-only
    );
    
    // Extract count from X-Total-Count header
    if (result && typeof result === 'object' && 'headers' in result) {
      const headers = (result as any).headers;
      const totalCount = headers['x-total-count'] || headers['X-Total-Count'];
      if (totalCount) {
        const count = parseInt(totalCount, 10);
        logInfo(`[SEARCH API] Count query returned: ${count}`);
        return count;
      }
    }
    
    logInfo(`[SEARCH API] Count query executed but no X-Total-Count header found`);
    return 0;
  } catch (error: any) {
    logError(`[SEARCH API] Count query failed:`, error);
    throw error;
  }
}
