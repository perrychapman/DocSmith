// backend/src/services/sailpointQueryPlanner.ts
// Intelligent query planning and execution for SailPoint queries with chunking support

import { anythingllmRequest } from './anythingllm';
import { executeSailPointQuery } from './sailpointChatIntegration';
import { logInfo, logError } from '../utils/logger';

interface SailPointContext {
  customerId: number;
  customerName: string;
  environment: 'sandbox' | 'prod';
}

interface QueryPlan {
  requiresPagination: boolean;
  estimatedPages: number;
  chunkSize: number;
  userApprovalNeeded: boolean;
  queries: Array<{
    action: string;
    filters?: string;
    limit: number;
    offset: number;
    description?: string;
  }>;
}

interface QueryExecution {
  success: boolean;
  results: any[];
  summary: string;
  error?: string;
}

/**
 * Analyze a user query to create an intelligent execution plan
 */
export async function createQueryPlan(
  userMessage: string,
  conversationHistory: string,
  workspaceSlug: string
): Promise<{ plan: string; needsUserApproval: boolean }> {
  const planningPrompt = `You are a SailPoint query planner. Analyze the user's request and determine:

1. Does this require fetching ALL data from SailPoint (pagination)?
2. What is the most efficient query strategy?
3. Should we ask for user approval before executing?

User Request: "${userMessage}"

${conversationHistory ? `Recent Context:\n${conversationHistory}\n` : ''}

Respond with a JSON plan:
{
  "requiresPagination": true/false,
  "estimatedItems": number (if known from context),
  "userApprovalNeeded": true/false,
  "reasoning": "why this plan",
  "query": {
    "action": "search_xxx or count_xxx",
    "limit": 250,
    "description": "what we're fetching"
  }
}

RULES:
- If user says "all", "everything", "complete breakdown" → requiresPagination: true
- If estimatedItems > 1000 → userApprovalNeeded: true
- If just asking "how many" → use count_xxx action
- If asking for "breakdown", "list", "show me" → use search_xxx
- Always start with limit: 250 for search queries
- Check context for previous responses mentioning total counts`;

  try {
    logInfo('[QUERY_PLANNER] Creating execution plan');
    const response = await anythingllmRequest<{ textResponse?: string }>(
      `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
      "POST",
      {
        message: planningPrompt,
        mode: 'chat',
        sessionId: 'system-query-planner'
      }
    );

    const planText = response.textResponse || '';
    
    // Extract JSON from response
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logError('[QUERY_PLANNER] Failed to extract JSON plan from response');
      return {
        plan: 'Could not create query plan',
        needsUserApproval: false
      };
    }

    const planData = JSON.parse(jsonMatch[0]);
    logInfo(`[QUERY_PLANNER] Plan created: ${JSON.stringify(planData)}`);

    return {
      plan: JSON.stringify(planData, null, 2),
      needsUserApproval: planData.userApprovalNeeded || false
    };
  } catch (error: any) {
    logError('[QUERY_PLANNER] Error creating plan:', error);
    return {
      plan: 'Error creating plan',
      needsUserApproval: false
    };
  }
}

/**
 * Execute queries in intelligent chunks with progress tracking
 */
export async function executeQueryInChunks(
  context: SailPointContext,
  baseQuery: any,
  totalItems: number,
  onProgress?: (completed: number, total: number, summary: string) => void
): Promise<QueryExecution> {
  const chunkSize = 250;
  const totalPages = Math.ceil(totalItems / chunkSize);
  const allResults: any[] = [];
  
  logInfo(`[QUERY_EXECUTOR] Executing query in ${totalPages} chunks (${totalItems} total items)`);

  try {
    // Execute in chunks
    for (let page = 0; page < totalPages; page++) {
      const offset = page * chunkSize;
      const query = {
        ...baseQuery,
        limit: chunkSize,
        offset
      };

      logInfo(`[QUERY_EXECUTOR] Fetching page ${page + 1}/${totalPages} (offset: ${offset})`);
      
      const result = await executeSailPointQuery(context, query);
      
      if (result.error) {
        logError(`[QUERY_EXECUTOR] Error on page ${page + 1}:`, result.error);
        throw new Error(result.error);
      }

      // Accumulate results
      if (result.data && Array.isArray(result.data)) {
        allResults.push(...result.data);
      }

      // Progress callback
      const itemsFetched = Math.min((page + 1) * chunkSize, totalItems);
      if (onProgress) {
        onProgress(
          itemsFetched,
          totalItems,
          `Fetched ${itemsFetched}/${totalItems} items (${Math.round((itemsFetched / totalItems) * 100)}%)`
        );
      }

      // Small delay to avoid rate limits
      if (page < totalPages - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    logInfo(`[QUERY_EXECUTOR] Successfully fetched all ${allResults.length} items`);

    return {
      success: true,
      results: allResults,
      summary: `Successfully fetched ${allResults.length} items across ${totalPages} pages`
    };
  } catch (error: any) {
    logError('[QUERY_EXECUTOR] Execution failed:', error);
    return {
      success: false,
      results: allResults,
      summary: `Partial results: ${allResults.length} items fetched before error`,
      error: error.message
    };
  }
}

/**
 * Aggregate results intelligently to avoid token limits
 */
export function aggregateResults(
  results: any[],
  aggregationType: 'by_source' | 'by_owner' | 'by_type' | 'count_only'
): any {
  logInfo(`[QUERY_AGGREGATOR] Aggregating ${results.length} results by ${aggregationType}`);

  switch (aggregationType) {
    case 'by_source': {
      const grouped: Record<string, number> = {};
      results.forEach(item => {
        const sourceName = item.source?.name || 'Unknown';
        grouped[sourceName] = (grouped[sourceName] || 0) + 1;
      });
      return {
        totalItems: results.length,
        breakdown: grouped,
        sources: Object.keys(grouped).length
      };
    }

    case 'by_owner': {
      const grouped: Record<string, number> = {};
      results.forEach(item => {
        const ownerName = item.owner?.name || 'Unknown';
        grouped[ownerName] = (grouped[ownerName] || 0) + 1;
      });
      return {
        totalItems: results.length,
        breakdown: grouped,
        owners: Object.keys(grouped).length
      };
    }

    case 'by_type': {
      const grouped: Record<string, number> = {};
      results.forEach(item => {
        const type = item.type || 'Unknown';
        grouped[type] = (grouped[type] || 0) + 1;
      });
      return {
        totalItems: results.length,
        breakdown: grouped,
        types: Object.keys(grouped).length
      };
    }

    case 'count_only': {
      return {
        totalItems: results.length
      };
    }

    default:
      return { totalItems: results.length };
  }
}

/**
 * Summarize large result sets to fit within token limits
 */
export function summarizeResults(
  results: any[],
  maxSampleSize: number = 50
): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  const sample = results.slice(0, maxSampleSize);
  const hasMore = results.length > maxSampleSize;

  return JSON.stringify({
    totalCount: results.length,
    sample: sample,
    sampleSize: sample.length,
    note: hasMore ? `Showing first ${maxSampleSize} of ${results.length} results` : 'Complete results'
  }, null, 2);
}

/**
 * Determine the best aggregation type from user query
 */
export function detectAggregationType(userMessage: string): 'by_source' | 'by_owner' | 'by_type' | 'count_only' | null {
  const lower = userMessage.toLowerCase();
  
  if (lower.includes('by source') || lower.includes('per source') || lower.includes('breakdown by source')) {
    return 'by_source';
  }
  if (lower.includes('by owner') || lower.includes('per owner')) {
    return 'by_owner';
  }
  if (lower.includes('by type') || lower.includes('per type')) {
    return 'by_type';
  }
  if (lower.includes('how many') || lower.includes('count')) {
    return 'count_only';
  }
  
  return null;
}
