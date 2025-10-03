// backend/src/services/metadataMatching.ts
import { loadTemplateMetadata, type TemplateMetadata } from './templateMetadata'
import { loadAllDocumentMetadata, type DocumentMetadata } from './documentMetadata'
import { anythingllmRequest } from './anythingllm'
import { logInfo, logError } from '../utils/logger'
import { createHash } from 'crypto'

// Cache for relevance scores (in-memory, 15-minute TTL)
const relevanceCache = new Map<string, { 
  rankings: DocumentMatch[], 
  timestamp: number 
}>()
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const AI_RANKING_TIMEOUT_MS = 10000 // 10 seconds
const MAX_AI_RANKING_CANDIDATES = 20 // Limit AI ranking to top 20 from rule-based

function getCacheKey(templateSlug: string, documentIds: number[]): string {
  const sortedIds = [...documentIds].sort((a, b) => a - b)
  return createHash('md5')
    .update(`${templateSlug}:${sortedIds.join(',')}`)
    .digest('hex')
}

/**
 * Match result containing relevance score and reasoning
 */
export interface DocumentMatch {
  filename: string
  metadata: DocumentMetadata
  relevanceScore: number
  reasoning: string
}

/**
 * Enhanced context for document generation with metadata-aware prompting
 */
export interface MetadataEnhancedContext {
  templateMetadata: TemplateMetadata | null
  relevantDocuments: DocumentMatch[]
  promptEnhancement: string
  documentSummaries: string
}

/**
 * Calculate relevance score between template requirements and document content
 * Uses simple keyword matching and boolean flags
 */
function calculateBasicRelevance(
  templateMeta: TemplateMetadata,
  docMeta: DocumentMetadata
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Match required data types
  if (templateMeta.requiredDataTypes && docMeta.dataCategories) {
    const overlap = templateMeta.requiredDataTypes.filter(type =>
      docMeta.dataCategories?.some(cat =>
        cat.toLowerCase().includes(type.toLowerCase()) ||
        type.toLowerCase().includes(cat.toLowerCase())
      )
    )
    if (overlap.length > 0) {
      score += overlap.length * 3
      reasons.push(`Matches ${overlap.length} required data types: ${overlap.join(', ')}`)
    }
  }

  // Match expected entities
  if (templateMeta.expectedEntities && docMeta.keyTopics) {
    const overlap = templateMeta.expectedEntities.filter(entity =>
      docMeta.keyTopics?.some(topic =>
        topic.toLowerCase().includes(entity.toLowerCase()) ||
        entity.toLowerCase().includes(topic.toLowerCase())
      )
    )
    if (overlap.length > 0) {
      score += overlap.length * 2
      reasons.push(`Contains ${overlap.length} expected entities: ${overlap.join(', ')}`)
    }
  }

  // Match compatible document types
  if (templateMeta.compatibleDocumentTypes && docMeta.documentType) {
    const isCompatible = templateMeta.compatibleDocumentTypes.some(type =>
      (docMeta.documentType?.toLowerCase().includes(type.toLowerCase()) ?? false) ||
      (docMeta.documentType && type.toLowerCase().includes(docMeta.documentType.toLowerCase()))
    )
    if (isCompatible) {
      score += 5
      reasons.push(`Document type '${docMeta.documentType}' is compatible`)
    }
  }

  // Check for aggregation capabilities
  if (templateMeta.requiresAggregation && docMeta.extraFields?.hasAggregations) {
    score += 2
    reasons.push('Document contains aggregations (matches template requirement)')
  }

  // Check for time-series data
  if (templateMeta.requiresTimeSeries && (docMeta.dateRange || docMeta.extraFields?.timeframe)) {
    score += 2
    reasons.push('Document has time-series data (matches template requirement)')
  }

  // Check for tables (structural match)
  if (templateMeta.hasTables && docMeta.hasTables) {
    score += 1
    reasons.push('Both have tabular data')
  }

  // Bonus for metrics if template needs aggregation
  const metrics = docMeta.extraFields?.metrics as string[] | undefined
  if (templateMeta.requiresAggregation && metrics && Array.isArray(metrics) && metrics.length > 0) {
    score += 2
    reasons.push(`Document has ${metrics.length} metrics`)
  }

  return { score, reasons }
}

/**
 * Use AI to intelligently rank document relevance based on template requirements
 */
async function aiRankDocuments(
  templateMeta: TemplateMetadata,
  documents: DocumentMetadata[],
  workspaceSlug: string
): Promise<DocumentMatch[]> {
  try {
    logInfo(`[METADATA-MATCHING] Using AI to rank ${documents.length} documents for template ${templateMeta.templateSlug}`)

    const rankingPrompt = `You are a document analysis expert. Given a template's requirements and a list of available documents, rank each document by relevance (0-10 scale) and explain why.

TEMPLATE REQUIREMENTS:
- Purpose: ${templateMeta.purpose || 'Not specified'}
- Required Data Types: ${templateMeta.requiredDataTypes?.join(', ') || 'Not specified'}
- Expected Entities: ${templateMeta.expectedEntities?.join(', ') || 'Not specified'}
- Data Structure Needs: ${templateMeta.dataStructureNeeds?.join(', ') || 'Not specified'}
- Requires Aggregation: ${templateMeta.requiresAggregation ? 'Yes' : 'No'}
- Requires Time-Series: ${templateMeta.requiresTimeSeries ? 'Yes' : 'No'}
- Requires Comparisons: ${templateMeta.requiresComparisons ? 'Yes' : 'No'}

AVAILABLE DOCUMENTS:
${documents.map((doc, idx) => `
${idx + 1}. ${doc.filename}
   - Type: ${doc.documentType || 'Unknown'}
   - Purpose: ${doc.purpose || 'Not specified'}
   - Data Categories: ${doc.dataCategories?.join(', ') || 'None'}
   - Key Topics: ${doc.keyTopics?.join(', ') || 'None'}
   - Has Tables: ${doc.hasTables ? 'Yes' : 'No'}
   - Metrics: ${(doc.extraFields?.metrics as string[] | undefined)?.join(', ') || 'None'}
   - Date Range: ${doc.dateRange || doc.meetingDate || 'None'}
`).join('\n')}

Return ONLY a JSON array with this structure:
[
  {
    "filename": "document1.xlsx",
    "relevanceScore": 8,
    "reasoning": "Contains inventory data with product quantities and costs, exactly what the template needs"
  },
  ...
]

Rank ALL documents, even if some have low relevance (score 0-2). Be specific in reasoning.`

    const result = await anythingllmRequest<any>(
      `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
      'POST',
      {
        message: rankingPrompt,
        mode: 'query'
      }
    )

    const responseText = String(result?.textResponse || result?.message || '')
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logError('[METADATA-MATCHING] AI response did not contain valid JSON array')
      return []
    }

    const rankings = JSON.parse(jsonMatch[0]) as Array<{
      filename: string
      relevanceScore: number
      reasoning: string
    }>

    // Match rankings with document metadata
    const matches: DocumentMatch[] = rankings
      .map(ranking => {
        const doc = documents.find(d => d.filename === ranking.filename)
        if (!doc) return null
        return {
          filename: ranking.filename,
          metadata: doc,
          relevanceScore: ranking.relevanceScore,
          reasoning: ranking.reasoning
        }
      })
      .filter((match): match is DocumentMatch => match !== null)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)

    logInfo(`[METADATA-MATCHING] AI ranked ${matches.length} documents, top score: ${matches[0]?.relevanceScore || 0}`)
    return matches

  } catch (err) {
    logError('[METADATA-MATCHING] AI ranking failed:', err)
    return []
  }
}

/**
 * Find relevant documents for a template using metadata matching
 * Combines rule-based and AI-based ranking
 */
export async function findRelevantDocuments(
  templateSlug: string,
  customerId: number,
  workspaceSlug: string,
  useAI: boolean = true
): Promise<DocumentMatch[]> {
  try {
    // Load template metadata
    const templateMeta = await loadTemplateMetadata(templateSlug)
    if (!templateMeta) {
      logInfo(`[METADATA-MATCHING] No template metadata found for ${templateSlug}`)
      return []
    }

    // Load all document metadata for this customer
    const documents = await loadAllDocumentMetadata(customerId)
    if (documents.length === 0) {
      logInfo(`[METADATA-MATCHING] No documents with metadata found for customer ${customerId}`)
      return []
    }

    logInfo(`[METADATA-MATCHING] Matching ${documents.length} documents against template ${templateSlug}`)

    // Use AI ranking if enabled and available
    if (useAI && workspaceSlug) {
      try {
        const aiMatches = await aiRankDocuments(templateMeta, documents, workspaceSlug)
        if (aiMatches.length > 0) {
          return aiMatches
        }
      } catch (err) {
        logError('[METADATA-MATCHING] AI ranking failed, falling back to basic matching:', err)
      }
    }

    // Fallback: Calculate basic relevance scores
    const matches: DocumentMatch[] = documents.map((doc: DocumentMetadata) => {
      const { score, reasons } = calculateBasicRelevance(templateMeta, doc)
      return {
        filename: doc.filename,
        metadata: doc,
        relevanceScore: score,
        reasoning: reasons.join('; ') || 'No specific matches found'
      }
    })

    // Sort by relevance
    matches.sort((a, b) => b.relevanceScore - a.relevanceScore)

    logInfo(`[METADATA-MATCHING] Basic matching complete, top score: ${matches[0]?.relevanceScore || 0}`)
    return matches

  } catch (err) {
    logError('[METADATA-MATCHING] Document matching failed:', err)
    throw err
  }
}

/**
 * Build enhanced context for document generation with metadata-aware prompting
 * Optimized with caching, timeouts, and selective AI ranking
 */
export async function buildMetadataEnhancedContext(
  templateSlug: string,
  customerId: number,
  workspaceSlug: string
): Promise<MetadataEnhancedContext> {
  const templateMetadata = await loadTemplateMetadata(templateSlug)
  const documents = customerId > 0 ? await loadAllDocumentMetadata(customerId) : []

  if (!templateMetadata) {
    logInfo(`[METADATA-MATCHING] No template metadata found for ${templateSlug}`)
    return {
      templateMetadata: null,
      relevantDocuments: [],
      promptEnhancement: '',
      documentSummaries: ''
    }
  }

  if (documents.length === 0) {
    logInfo(`[METADATA-MATCHING] No documents with metadata found for customer ${customerId}`)
    return {
      templateMetadata,
      relevantDocuments: [],
      promptEnhancement: buildPromptEnhancement(templateMetadata, []),
      documentSummaries: buildDocumentSummaries([])
    }
  }

  // OPTIMIZATION 1: Check cache first
  const docIds = documents.map(d => d.id).filter((id): id is number => id !== undefined)
  const cacheKey = getCacheKey(templateSlug, docIds)
  const cached = relevanceCache.get(cacheKey)
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    logInfo(`[METADATA-MATCHING] Using cached rankings (${cached.rankings.length} docs, age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`)
    return {
      templateMetadata,
      relevantDocuments: cached.rankings,
      promptEnhancement: buildPromptEnhancement(templateMetadata, cached.rankings),
      documentSummaries: buildDocumentSummaries(cached.rankings)
    }
  }

  // OPTIMIZATION 2: Run rule-based matching first (fast, always succeeds)
  logInfo(`[METADATA-MATCHING] Rule-based matching for ${documents.length} documents`)
  const ruleBasedMatches: DocumentMatch[] = documents.map((doc: DocumentMetadata) => {
    const { score, reasons } = calculateBasicRelevance(templateMetadata, doc)
    return {
      filename: doc.filename,
      metadata: doc,
      relevanceScore: score,
      reasoning: reasons.join('; ') || 'No specific matches found'
    }
  }).sort((a, b) => b.relevanceScore - a.relevanceScore)

  // OPTIMIZATION 3: Limit AI ranking to top candidates (not all documents)
  const topCandidates = ruleBasedMatches.slice(0, MAX_AI_RANKING_CANDIDATES)
  
  logInfo(`[METADATA-MATCHING] AI ranking top ${topCandidates.length} of ${documents.length} docs (timeout: ${AI_RANKING_TIMEOUT_MS}ms)`)
  
  let relevantDocuments = ruleBasedMatches // Default fallback
  
  // OPTIMIZATION 4: Add timeout to AI ranking
  if (workspaceSlug && topCandidates.length > 0) {
    try {
      const aiRankingPromise = aiRankDocuments(templateMetadata, topCandidates.map(m => m.metadata), workspaceSlug)
      const timeoutPromise = new Promise<DocumentMatch[]>((_, reject) => 
        setTimeout(() => reject(new Error('AI ranking timeout')), AI_RANKING_TIMEOUT_MS)
      )
      
      const aiRankings = await Promise.race([aiRankingPromise, timeoutPromise])
      
      if (aiRankings.length > 0) {
        // Merge AI rankings with remaining rule-based matches
        const aiRankedIds = new Set(aiRankings.map(d => d.metadata.id).filter((id): id is number => id !== undefined))
        const remaining = ruleBasedMatches.filter(d => d.metadata.id && !aiRankedIds.has(d.metadata.id))
        relevantDocuments = [...aiRankings, ...remaining]
        
        logInfo(`[METADATA-MATCHING] AI ranking complete (${aiRankings.length} ranked by AI, top score: ${aiRankings[0]?.relevanceScore || 0})`)
      } else {
        logInfo('[METADATA-MATCHING] AI returned no rankings, using rule-based')
      }
    } catch (err) {
      logError(`[METADATA-MATCHING] AI ranking failed/timeout, using rule-based: ${(err as Error).message}`)
      // relevantDocuments already set to ruleBasedMatches above
    }
  } else {
    logInfo('[METADATA-MATCHING] Skipping AI ranking (no workspace or no candidates)')
  }

  // OPTIMIZATION 5: Cache the results
  relevanceCache.set(cacheKey, {
    rankings: relevantDocuments,
    timestamp: Date.now()
  })
  
  // Clean old cache entries (keep last 100)
  if (relevanceCache.size > 100) {
    const sorted = Array.from(relevanceCache.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
    relevanceCache.clear()
    sorted.slice(0, 100).forEach(([k, v]) => relevanceCache.set(k, v))
  }

  // Build prompt enhancement based on metadata
  let promptEnhancement = ''
  
  if (templateMetadata) {
    promptEnhancement += '\n\n=== TEMPLATE CONTEXT ===\n'
    promptEnhancement += `This template requires: ${templateMetadata.purpose || 'document generation'}\n`
    
    if (templateMetadata.requiredDataTypes && templateMetadata.requiredDataTypes.length > 0) {
      promptEnhancement += `Expected data types: ${templateMetadata.requiredDataTypes.join(', ')}\n`
    }
    
    if (templateMetadata.expectedEntities && templateMetadata.expectedEntities.length > 0) {
      promptEnhancement += `Key entities needed: ${templateMetadata.expectedEntities.join(', ')}\n`
    }
    
    const operations: string[] = []
    if (templateMetadata.requiresAggregation) operations.push('aggregation (sums, averages, counts)')
    if (templateMetadata.requiresTimeSeries) operations.push('time-series ordering')
    if (templateMetadata.requiresComparisons) operations.push('comparisons (before/after)')
    if (templateMetadata.requiresFiltering) operations.push('data filtering')
    
    if (operations.length > 0) {
      promptEnhancement += `Required operations: ${operations.join(', ')}\n`
    }
  }

  // Build document summaries with relevance scores
  let documentSummaries = ''
  
  if (relevantDocuments.length > 0) {
    documentSummaries += '\n\n=== RELEVANT WORKSPACE DOCUMENTS ===\n'
    documentSummaries += `Found ${relevantDocuments.length} documents. Focus on the most relevant:\n\n`
    
    // Include top 5 documents with detailed context
    const topDocuments = relevantDocuments.slice(0, 5)
    topDocuments.forEach((match, idx) => {
      documentSummaries += `${idx + 1}. ${match.filename} (Relevance: ${match.relevanceScore}/10)\n`
      documentSummaries += `   Reason: ${match.reasoning}\n`
      if (match.metadata.purpose) {
        documentSummaries += `   Purpose: ${match.metadata.purpose}\n`
      }
      if (match.metadata.dataCategories && match.metadata.dataCategories.length > 0) {
        documentSummaries += `   Contains: ${match.metadata.dataCategories.join(', ')}\n`
      }
      const docMetrics = match.metadata.extraFields?.metrics as string[] | undefined
      if (docMetrics && Array.isArray(docMetrics) && docMetrics.length > 0) {
        documentSummaries += `   Metrics: ${docMetrics.slice(0, 5).join(', ')}${docMetrics.length > 5 ? '...' : ''}\n`
      }
      documentSummaries += '\n'
    })
    
    // List remaining documents briefly
    if (relevantDocuments.length > 5) {
      documentSummaries += `Other available documents (${relevantDocuments.length - 5}):\n`
      relevantDocuments.slice(5).forEach(match => {
        documentSummaries += `- ${match.filename} (Relevance: ${match.relevanceScore}/10)\n`
      })
    }
  } else {
    documentSummaries += '\n\n=== NO DOCUMENT METADATA AVAILABLE ===\n'
    documentSummaries += 'No analyzed documents found in workspace. Will use general workspace query.\n'
  }

  return {
    templateMetadata,
    relevantDocuments,
    promptEnhancement: buildPromptEnhancement(templateMetadata, relevantDocuments),
    documentSummaries: buildDocumentSummaries(relevantDocuments)
  }
}

/**
 * Build prompt enhancement text from template metadata
 */
function buildPromptEnhancement(
  templateMetadata: TemplateMetadata | null,
  relevantDocuments: DocumentMatch[]
): string {
  let promptEnhancement = ''
  
  if (templateMetadata) {
    promptEnhancement += '\n\n=== TEMPLATE CONTEXT ===\n'
    promptEnhancement += `This template requires: ${templateMetadata.purpose || 'document generation'}\n`
    
    if (templateMetadata.requiredDataTypes && templateMetadata.requiredDataTypes.length > 0) {
      promptEnhancement += `Expected data types: ${templateMetadata.requiredDataTypes.join(', ')}\n`
    }
    
    if (templateMetadata.expectedEntities && templateMetadata.expectedEntities.length > 0) {
      promptEnhancement += `Key entities needed: ${templateMetadata.expectedEntities.join(', ')}\n`
    }
    
    const operations: string[] = []
    if (templateMetadata.requiresAggregation) operations.push('aggregation (sums, averages, counts)')
    if (templateMetadata.requiresTimeSeries) operations.push('time-series ordering')
    if (templateMetadata.requiresComparisons) operations.push('comparisons (before/after)')
    if (templateMetadata.requiresFiltering) operations.push('data filtering')
    
    if (operations.length > 0) {
      promptEnhancement += `Required operations: ${operations.join(', ')}\n`
    }
  }

  return promptEnhancement
}

/**
 * Build document summaries text from relevant documents
 */
function buildDocumentSummaries(relevantDocuments: DocumentMatch[]): string {
  let documentSummaries = ''
  
  if (relevantDocuments.length > 0) {
    documentSummaries += '\n\n=== RELEVANT WORKSPACE DOCUMENTS ===\n'
    documentSummaries += `Found ${relevantDocuments.length} documents. Focus on the most relevant:\n\n`
    
    // Include top 5 documents with detailed context
    const topDocuments = relevantDocuments.slice(0, 5)
    topDocuments.forEach((match, idx) => {
      documentSummaries += `${idx + 1}. ${match.filename} (Relevance: ${match.relevanceScore}/10)\n`
      documentSummaries += `   Reason: ${match.reasoning}\n`
      if (match.metadata.purpose) {
        documentSummaries += `   Purpose: ${match.metadata.purpose}\n`
      }
      if (match.metadata.dataCategories && match.metadata.dataCategories.length > 0) {
        documentSummaries += `   Contains: ${match.metadata.dataCategories.join(', ')}\n`
      }
      const docMetrics = match.metadata.extraFields?.metrics as string[] | undefined
      if (docMetrics && Array.isArray(docMetrics) && docMetrics.length > 0) {
        documentSummaries += `   Metrics: ${docMetrics.slice(0, 5).join(', ')}${docMetrics.length > 5 ? '...' : ''}\n`
      }
      documentSummaries += '\n'
    })
    
    // List remaining documents briefly
    if (relevantDocuments.length > 5) {
      documentSummaries += `Other available documents (${relevantDocuments.length - 5}):\n`
      relevantDocuments.slice(5).forEach(match => {
        documentSummaries += `- ${match.filename} (Relevance: ${match.relevanceScore}/10)\n`
      })
    }
  } else {
    documentSummaries += '\n\n=== NO DOCUMENT METADATA AVAILABLE ===\n'
    documentSummaries += 'No analyzed documents found in workspace. Will use general workspace query.\n'
  }

  return documentSummaries
}
