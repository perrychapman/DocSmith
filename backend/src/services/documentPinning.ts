// backend/src/services/documentPinning.ts
import { anythingllmRequest } from './anythingllm'
import { loadAllDocumentMetadata } from './documentMetadata'
import { logInfo, logError } from '../utils/logger'

/**
 * Pin/unpin result with details of what was pinned
 */
export interface PinningResult {
  pinnedDocuments: string[]  // Document paths that were pinned
  totalRelevantDocs: number  // Total number of relevant documents found
  highestScore: number       // Highest relevance score
  lowestPinnedScore: number  // Lowest score among pinned documents
}

/**
 * Intelligently pin relevant documents for a specific template before generation
 * 
 * @param workspaceSlug - AnythingLLM workspace slug
 * @param templateSlug - Template slug to find relevant documents for
 * @param customerId - Customer ID to find documents for
 * @param minScore - Minimum relevance score to pin (default: 7.0)
 * @returns Details about which documents were pinned
 */
export async function pinRelevantDocuments(
  workspaceSlug: string,
  templateSlug: string,
  customerId: number,
  minScore: number = 7.0
): Promise<PinningResult> {
  logInfo(`[DOC-PINNING] Finding relevant documents for template ${templateSlug}`)
  
  try {
    // Load all customer documents with metadata
    const documents = await loadAllDocumentMetadata(customerId)
    
    if (documents.length === 0) {
      logInfo('[DOC-PINNING] No documents found for customer')
      return {
        pinnedDocuments: [],
        totalRelevantDocs: 0,
        highestScore: 0,
        lowestPinnedScore: 0
      }
    }
    
    logInfo(`[DOC-PINNING] Loaded ${documents.length} customer documents`)
    
    // Extract documents with template relevance scores
    const relevantDocs = documents
      .map(doc => {
        // Check if document has template relevance scores
        const templateRelevance = doc.extraFields?.templateRelevance as Array<{
          slug: string
          name: string
          score: number
          reasoning: string
        }> | undefined
        
        if (!templateRelevance || !Array.isArray(templateRelevance)) {
          return null
        }
        
        // Find score for this specific template
        const scoreForTemplate = templateRelevance.find(t => t.slug === templateSlug)
        
        if (!scoreForTemplate) {
          return null
        }
        
        return {
          filename: doc.filename,
          anythingllmPath: doc.anythingllmPath,
          score: scoreForTemplate.score,
          reasoning: scoreForTemplate.reasoning
        }
      })
      .filter((doc): doc is { filename: string; anythingllmPath: string | undefined; score: number; reasoning: string } =>
        doc !== null && doc.score >= minScore
      )
      .sort((a, b) => b.score - a.score) // Sort by score descending
    
    if (relevantDocs.length === 0) {
      logInfo(`[DOC-PINNING] No documents found with relevance score >= ${minScore}`)
      return {
        pinnedDocuments: [],
        totalRelevantDocs: 0,
        highestScore: 0,
        lowestPinnedScore: 0
      }
    }
    
    logInfo(`[DOC-PINNING] Found ${relevantDocs.length} relevant documents (score >= ${minScore})`)
    
    // Pin each relevant document
    const pinnedPaths: string[] = []
    for (const doc of relevantDocs) {
      try {
        // Use the stored AnythingLLM path if available, fallback to just filename
        const docPath = doc.anythingllmPath || doc.filename
        
        if (!doc.anythingllmPath) {
          logInfo(`[DOC-PINNING] Document ${doc.filename} missing anythingllmPath, using filename only (may fail)`)
        }
        
        logInfo(`[DOC-PINNING] Pinning: ${docPath} (score: ${doc.score}/10)`)
        
        await anythingllmRequest(
          `/workspace/${encodeURIComponent(workspaceSlug)}/update-pin`,
          'POST',
          {
            docPath: docPath,
            pinStatus: true
          }
        )
        
        pinnedPaths.push(docPath)
        logInfo(`[DOC-PINNING] Pinned: ${docPath}`)
      } catch (pinErr) {
        logError(`[DOC-PINNING] Failed to pin ${doc.filename}:`, pinErr)
        // Continue with other documents even if one fails
      }
    }
    
    const result: PinningResult = {
      pinnedDocuments: pinnedPaths,
      totalRelevantDocs: relevantDocs.length,
      highestScore: relevantDocs[0]?.score || 0,
      lowestPinnedScore: relevantDocs[relevantDocs.length - 1]?.score || 0
    }
    
    logInfo(`[DOC-PINNING] Pinning complete: ${pinnedPaths.length}/${relevantDocs.length} documents pinned`)
    if (pinnedPaths.length > 0) {
      logInfo(`[DOC-PINNING] Score range: ${result.highestScore.toFixed(1)} - ${result.lowestPinnedScore.toFixed(1)}`)
    }
    
    return result
    
  } catch (err) {
    logError('[DOC-PINNING] Error during document pinning:', err)
    throw err
  }
}

/**
 * Unpin documents that were pinned for generation
 * 
 * @param workspaceSlug - AnythingLLM workspace slug
 * @param documentPaths - Array of document paths to unpin
 */
export async function unpinDocuments(
  workspaceSlug: string,
  documentPaths: string[]
): Promise<void> {
  if (documentPaths.length === 0) {
    logInfo('[DOC-UNPINNING] No documents to unpin')
    return
  }
  
  logInfo(`[DOC-UNPINNING] Unpinning ${documentPaths.length} documents`)
  
  for (const docPath of documentPaths) {
    try {
      await anythingllmRequest(
        `/workspace/${encodeURIComponent(workspaceSlug)}/update-pin`,
        'POST',
        {
          docPath: docPath,
          pinStatus: false
        }
      )
      
      logInfo(`[DOC-UNPINNING] Unpinned: ${docPath}`)
    } catch (unpinErr) {
      logError(`[DOC-UNPINNING] Failed to unpin ${docPath}:`, unpinErr)
      // Continue with other documents even if one fails
    }
  }
  
  logInfo('[DOC-UNPINNING] Unpinning complete')
}

/**
 * Pin documents with error handling and cleanup
 * Use this wrapper for safe pinning/unpinning in generation pipeline
 */
export async function withDocumentPinning<T>(
  workspaceSlug: string,
  templateSlug: string,
  customerId: number,
  operation: (pinningResult: PinningResult) => Promise<T>,
  minScore: number = 7.0
): Promise<T> {
  let pinningResult: PinningResult | null = null
  
  try {
    // Pin relevant documents
    pinningResult = await pinRelevantDocuments(
      workspaceSlug,
      templateSlug,
      customerId,
      minScore
    )
    
    // Execute the operation (document generation)
    const result = await operation(pinningResult)
    
    // Unpin on success
    if (pinningResult.pinnedDocuments.length > 0) {
      await unpinDocuments(workspaceSlug, pinningResult.pinnedDocuments)
    }
    
    return result
    
  } catch (err) {
    // Unpin on error (cleanup)
    if (pinningResult && pinningResult.pinnedDocuments.length > 0) {
      try {
        await unpinDocuments(workspaceSlug, pinningResult.pinnedDocuments)
      } catch (cleanupErr) {
        logError('[DOC-PINNING] Failed to cleanup pinned documents after error:', cleanupErr)
      }
    }
    
    throw err
  }
}
