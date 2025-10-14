// backend/src/services/metadataMatching.ts
import { loadTemplateMetadata, type TemplateMetadata } from './templateMetadata'
import { loadAllDocumentMetadata, type DocumentMetadata } from './documentMetadata'
import { anythingllmRequest } from './anythingllm'
import { getDB } from './storage'
import { logInfo, logError } from '../utils/logger'

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
 * Returns score (0-10) with detailed reasoning
 * 
 * IMPORTANT: This matching is CONTENT-BASED, not file-type-based.
 * A .md file with meeting notes can match a .xlsx template if the content matches.
 * We care about WHAT DATA the document contains, not what format it's in.
 * 
 * Scoring breakdown (max 10 points):
 * - Data Type Match: 0-4 points (MOST IMPORTANT - Financial, Sales, Technical, etc.)
 * - Document Type Compatibility: 0-1 points (SOFT bonus - format doesn't matter much)
 * - Entity/Topic Match: 0-3 points (HIGH IMPORTANCE - Customers, Products, Projects, etc.)
 * - Additional Content: 0-2 points (Systems, departments, purpose alignment)
 * - Structural Bonuses: 0-2 points (Tables, time-series, aggregations)
 */
export function calculateBasicRelevance(
  templateMeta: TemplateMetadata,
  docMeta: DocumentMetadata
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // 1. Data Type Match (0-4 points) - MOST IMPORTANT
  if (templateMeta.requiredDataTypes && templateMeta.requiredDataTypes.length > 0) {
    if (docMeta.dataCategories && docMeta.dataCategories.length > 0) {
      const overlap = templateMeta.requiredDataTypes.filter(type =>
        docMeta.dataCategories?.some(cat =>
          cat.toLowerCase().includes(type.toLowerCase()) ||
          type.toLowerCase().includes(cat.toLowerCase())
        )
      )
      
      if (overlap.length > 0) {
        const matchRatio = overlap.length / templateMeta.requiredDataTypes.length
        const points = matchRatio * 4
        score += points
        
        if (matchRatio >= 1) {
          reasons.push(`Matches ALL ${overlap.length} required data types: ${overlap.join(', ')}`)
        } else {
          reasons.push(`Matches ${overlap.length}/${templateMeta.requiredDataTypes.length} data types: ${overlap.join(', ')}`)
        }
      }
    }
  } else {
    // No specific data type requirements - give base score
    score += 2
  }

  // 2. Document Type Compatibility (0-1 points) - DE-EMPHASIZED
  // NOTE: This is a SOFT match - we care about CONTENT, not file format
  // A .md meeting notes file can provide data for a .xlsx template
  if (templateMeta.compatibleDocumentTypes && templateMeta.compatibleDocumentTypes.length > 0) {
    if (docMeta.documentType) {
      const isCompatible = templateMeta.compatibleDocumentTypes.some(type =>
        docMeta.documentType?.toLowerCase().includes(type.toLowerCase()) ||
        type.toLowerCase().includes(docMeta.documentType?.toLowerCase() || '')
      )
      if (isCompatible) {
        score += 0.5  // Reduced from 2 to 0.5 - this is just a bonus, not a requirement
        reasons.push(`Document type '${docMeta.documentType}' is compatible (bonus)`)
      }
    }
  }
  // Always give base score regardless of document type match
  score += 0.5

  // 3. Entity/Topic Match (0-3 points) - INCREASED IMPORTANCE
  // This is what really matters - does the document contain the data we need?
  if (templateMeta.expectedEntities && templateMeta.expectedEntities.length > 0) {
    let overlap: string[] = []
    if (docMeta.keyTopics && docMeta.keyTopics.length > 0) {
      overlap = templateMeta.expectedEntities.filter(entity =>
        docMeta.keyTopics?.some(topic =>
          topic.toLowerCase().includes(entity.toLowerCase()) ||
          entity.toLowerCase().includes(topic.toLowerCase())
        )
      )
      
      if (overlap.length > 0) {
        const matchRatio = overlap.length / templateMeta.expectedEntities.length
        const points = matchRatio * 3  // Increased from 2 to 3
        score += points
        reasons.push(`Contains ${overlap.length}/${templateMeta.expectedEntities.length} expected entities: ${overlap.join(', ')}`)
      }
    }
    
    // Also check if entities are mentioned in stakeholders or primary entities
    if (docMeta.stakeholders && docMeta.stakeholders.length > 0) {
      const stakeholderOverlap = templateMeta.expectedEntities.filter(entity =>
        docMeta.stakeholders?.some(stakeholder =>
          stakeholder.toLowerCase().includes(entity.toLowerCase()) ||
          entity.toLowerCase().includes(stakeholder.toLowerCase())
        )
      )
      if (stakeholderOverlap.length > 0 && !overlap.length) {
        score += 0.5
        reasons.push(`Mentions ${stakeholderOverlap.length} expected entities in stakeholders`)
      }
    }
    
    // Check extraFields.primaryEntities if available
    const primaryEntities = docMeta.extraFields?.primaryEntities as string[] | undefined
    if (primaryEntities && Array.isArray(primaryEntities) && primaryEntities.length > 0) {
      const entityOverlap = templateMeta.expectedEntities.filter(entity =>
        primaryEntities.some(pe =>
          pe.toLowerCase().includes(entity.toLowerCase()) ||
          entity.toLowerCase().includes(pe.toLowerCase())
        )
      )
      if (entityOverlap.length > 0 && !overlap.length) {
        score += 1
        reasons.push(`Contains ${entityOverlap.length} expected entities in primary entities`)
      }
    }
  } else {
    // No specific entity requirements - give base score
    score += 1.5  // Increased from 1
  }

  // 3.5. Additional Content Matching (0-2 points) - NEW
  // Check for system/technology mentions that match template context
  let contentMatchPoints = 0
  
  // Match mentioned systems if template has context about systems
  if (docMeta.mentionedSystems && docMeta.mentionedSystems.length > 0) {
    const templateSystems = templateMeta.expectedEntities?.filter(e => 
      ['system', 'platform', 'application', 'tool', 'software', 'service'].some(keyword =>
        e.toLowerCase().includes(keyword)
      )
    ) || []
    
    if (templateSystems.length > 0) {
      const systemMatch = templateSystems.some(ts =>
        docMeta.mentionedSystems?.some(ds =>
          ds.toLowerCase().includes(ts.toLowerCase()) ||
          ts.toLowerCase().includes(ds.toLowerCase())
        )
      )
      if (systemMatch) {
        contentMatchPoints += 0.5
        reasons.push('Mentions relevant systems/platforms')
      }
    }
  }
  
  // Match departments/teams if relevant
  const templateDepts = templateMeta.targetAudience?.toLowerCase() || ''
  const docDepts = docMeta.extraFields?.departments as string[] | undefined
  if (docDepts && Array.isArray(docDepts) && docDepts.length > 0 && templateDepts) {
    const deptMatch = docDepts.some(dept => 
      templateDepts.includes(dept.toLowerCase()) ||
      dept.toLowerCase().includes(templateDepts)
    )
    if (deptMatch) {
      contentMatchPoints += 0.5
      reasons.push('Relevant to target audience/department')
    }
  }
  
  // Match purpose/use case overlap
  if (docMeta.purpose && templateMeta.purpose) {
    const docPurposeLower = docMeta.purpose.toLowerCase()
    const templatePurposeLower = templateMeta.purpose.toLowerCase()
    
    // Check for key shared terms
    const sharedTerms = ['report', 'analysis', 'summary', 'tracking', 'planning', 
                         'metrics', 'performance', 'status', 'review', 'assessment']
    const docTerms = sharedTerms.filter(term => docPurposeLower.includes(term))
    const templateTerms = sharedTerms.filter(term => templatePurposeLower.includes(term))
    const overlap = docTerms.filter(term => templateTerms.includes(term))
    
    if (overlap.length > 0) {
      contentMatchPoints += 0.5
      reasons.push(`Shared purpose: ${overlap.join(', ')}`)
    }
  }
  
  score += Math.min(2, contentMatchPoints)

  // 4. Structural Bonuses (0-2 points total)
  let structuralPoints = 0
  
  // Tables bonus
  if (templateMeta.hasTables && docMeta.hasTables) {
    structuralPoints += 0.5
    reasons.push('Both have tabular data')
  }
  
  // Aggregation bonus
  if (templateMeta.requiresAggregation) {
    const metrics = docMeta.extraFields?.metrics as string[] | undefined
    const hasAggregations = docMeta.extraFields?.hasAggregations
    
    if (hasAggregations || (metrics && Array.isArray(metrics) && metrics.length > 0)) {
      structuralPoints += 0.75
      if (metrics && Array.isArray(metrics) && metrics.length > 0) {
        reasons.push(`Has ${metrics.length} metrics for aggregation`)
      } else {
        reasons.push('Has aggregations')
      }
    }
  }
  
  // Time-series bonus
  if (templateMeta.requiresTimeSeries) {
    if (docMeta.dateRange || docMeta.extraFields?.timeframe || docMeta.meetingDate) {
      structuralPoints += 0.75
      reasons.push('Has time-series/temporal data')
    }
  }
  
  score += structuralPoints

  // Ensure score is in 0-10 range
  score = Math.min(10, Math.max(0, score))
  
  // Add context reasoning if no specific matches
  if (reasons.length === 0) {
    reasons.push('General compatibility based on available metadata')
  }

  return { 
    score: Math.round(score * 10) / 10, // Round to 1 decimal
    reasons 
  }
}

/**
 * Find relevant documents for a template using metadata matching
 * Uses stored template relevance from document metadata when available
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

    // Build matches using stored template relevance when available
    const matches: DocumentMatch[] = documents.map((doc: DocumentMetadata) => {
      // Check if this document has pre-calculated template relevance
      const storedRelevance = doc.extraFields?.templateRelevance as Array<{
        slug: string; name: string; score: number; reasoning: string
      }> | undefined
      
      const matchForThisTemplate = storedRelevance?.find(t => t.slug === templateSlug)
      
      if (matchForThisTemplate) {
        // Use stored score from document metadata
        return {
          filename: doc.filename,
          metadata: doc,
          relevanceScore: matchForThisTemplate.score,
          reasoning: matchForThisTemplate.reasoning
        }
      } else {
        // Calculate on the fly if not stored (fallback)
        const { score, reasons } = calculateBasicRelevance(templateMeta, doc)
        return {
          filename: doc.filename,
          metadata: doc,
          relevanceScore: score,
          reasoning: reasons.join('; ') || 'No specific matches found'
        }
      }
    })

    // Sort by relevance
    matches.sort((a, b) => b.relevanceScore - a.relevanceScore)

    logInfo(`[METADATA-MATCHING] Matching complete, top score: ${matches[0]?.relevanceScore || 0}/10`)
    return matches

  } catch (err) {
    logError('[METADATA-MATCHING] Document matching failed:', err)
    throw err
  }
}

/**
 * Build enhanced context for document generation with metadata-aware prompting
 * Uses stored template relevance from document metadata when available
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

  logInfo(`[METADATA-MATCHING] Building context for ${documents.length} documents against template ${templateSlug}`)

  // Use stored template relevance from document metadata if available
  const relevantDocuments: DocumentMatch[] = documents.map((doc: DocumentMetadata) => {
    // Check if this document has pre-calculated template relevance
    const storedRelevance = doc.extraFields?.templateRelevance as Array<{
      slug: string; name: string; score: number; reasoning: string
    }> | undefined
    
    const matchForThisTemplate = storedRelevance?.find(t => t.slug === templateSlug)
    
    if (matchForThisTemplate) {
      // Use stored score from document metadata
      return {
        filename: doc.filename,
        metadata: doc,
        relevanceScore: matchForThisTemplate.score,
        reasoning: matchForThisTemplate.reasoning
      }
    } else {
      // Calculate on the fly if not stored (fallback)
      const { score, reasons } = calculateBasicRelevance(templateMetadata, doc)
      return {
        filename: doc.filename,
        metadata: doc,
        relevanceScore: score,
        reasoning: reasons.join('; ') || 'No specific matches found'
      }
    }
  }).sort((a, b) => b.relevanceScore - a.relevanceScore)

  logInfo(`[METADATA-MATCHING] Context built, top score: ${relevantDocuments[0]?.relevanceScore || 0}/10`)

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

/**
 * Calculate template relevance scores for a given document using AI
 * Returns templates ranked by relevance to the document
 */
export async function calculateDocumentTemplateRelevance(
  docMetadata: DocumentMetadata,
  workspaceSlug?: string
): Promise<Array<{ templateSlug: string, templateName: string, score: number, reasoning: string }>> {
  logInfo(`[METADATA-MATCHING] Calculating template relevance for document: ${docMetadata.filename}`)
  
  try {
    // Get all templates
    const db = getDB()
    const templates: TemplateMetadata[] = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM template_metadata`,
        [],
        async (err, rows: any[]) => {
          if (err) return reject(err)
          
          const promises = rows.map(row => loadTemplateMetadata(row.templateSlug))
          const results = await Promise.all(promises)
          resolve(results.filter(t => t !== null) as TemplateMetadata[])
        }
      )
    })
    
    if (templates.length === 0) {
      logInfo(`[METADATA-MATCHING] No templates found with metadata`)
      return []
    }

    // Try AI-powered similarity scoring if workspace is available
    if (workspaceSlug) {
      try {
        const aiScores = await aiCalculateTemplateSimilarity(docMetadata, templates, workspaceSlug)
        if (aiScores.length > 0) {
          logInfo(`[METADATA-MATCHING] AI calculated relevance for ${aiScores.length} templates`)
          if (aiScores.length > 0) {
            logInfo(`[METADATA-MATCHING] Top match: ${aiScores[0].templateName} (${aiScores[0].score}/10)`)
          }
          return aiScores
        }
      } catch (err) {
        logError(`[METADATA-MATCHING] AI similarity scoring failed, falling back to rule-based:`, err)
      }
    }
    
    // Fallback: Rule-based calculation
    logInfo(`[METADATA-MATCHING] Using rule-based similarity scoring`)
    const relevanceScores = templates.map(template => {
      const result = calculateBasicRelevance(template, docMetadata)
      const reasoning = result.reasons.join('; ') || (result.score > 5 ? 'General compatibility' : 'Low compatibility')
      
      return {
        templateSlug: template.templateSlug,
        templateName: template.templateName,
        score: result.score,
        reasoning
      }
    })
    
    // Sort by score descending
    const sorted = relevanceScores.sort((a, b) => b.score - a.score)
    
    logInfo(`[METADATA-MATCHING] Calculated relevance for ${sorted.length} templates`)
    if (sorted.length > 0) {
      logInfo(`[METADATA-MATCHING] Top match: ${sorted[0].templateName} (${sorted[0].score}/10)`)
    }
    
    return sorted
  } catch (err) {
    logError(`[METADATA-MATCHING] Error calculating template relevance:`, err)
    return []
  }
}

/**
 * Use AI to calculate similarity scores between document and templates
 */
async function aiCalculateTemplateSimilarity(
  docMetadata: DocumentMetadata,
  templates: TemplateMetadata[],
  workspaceSlug: string
): Promise<Array<{ templateSlug: string, templateName: string, score: number, reasoning: string }>> {
  
  const prompt = `You are a document-template matching expert. Analyze this document's metadata and score how well it matches each template (0-10 scale).

DOCUMENT METADATA:
Filename: ${docMetadata.filename}
Type: ${docMetadata.documentType || 'Unknown'}
Purpose: ${docMetadata.purpose || 'Not specified'}
Data Categories: ${docMetadata.dataCategories?.join(', ') || 'None'}
Key Topics: ${docMetadata.keyTopics?.join(', ') || 'None'}
Has Tables: ${docMetadata.hasTables ? 'Yes' : 'No'}
Has Metrics: ${(docMetadata.extraFields?.metrics as string[] | undefined)?.length || 0}
Date Range: ${docMetadata.dateRange || docMetadata.meetingDate || 'None'}
Structure: ${docMetadata.extraFields?.dataStructure || 'Not specified'}

TEMPLATES TO MATCH AGAINST:
${templates.map((t, idx) => `
${idx + 1}. ${t.templateName} (${t.templateSlug})
   Purpose: ${t.purpose || 'Not specified'}
   Required Data Types: ${t.requiredDataTypes?.join(', ') || 'None'}
   Expected Entities: ${t.expectedEntities?.join(', ') || 'None'}
   Compatible Doc Types: ${t.compatibleDocumentTypes?.join(', ') || 'Any'}
   Needs Aggregation: ${t.requiresAggregation ? 'Yes' : 'No'}
   Needs Time-Series: ${t.requiresTimeSeries ? 'Yes' : 'No'}
   Has Tables: ${t.hasTables ? 'Yes' : 'No'}
`).join('\n')}

Score each template 0-10 based on:
- Data type match (most important)
- Document type compatibility
- Entity/topic overlap
- Structural alignment (tables, metrics, dates)

Return ONLY a JSON array:
[
  {
    "templateSlug": "slug-here",
    "score": 8.5,
    "reasoning": "Matches inventory data types and metrics"
  },
  ...
]

CRITICAL: Keep reasoning to less than 40 words. Be concise and specific.
Score strictly - only give 7+ if document truly has what template needs.`

  const result = await anythingllmRequest<any>(
    `/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
    'POST',
    {
      message: prompt,
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

  const aiScores = JSON.parse(jsonMatch[0]) as Array<{
    templateSlug: string
    score: number
    reasoning: string
  }>

  // Match scores with template names and sort
  const matches = aiScores
    .map(aiScore => {
      const template = templates.find(t => t.templateSlug === aiScore.templateSlug)
      if (!template) return null
      
      return {
        templateSlug: aiScore.templateSlug,
        templateName: template.templateName,
        score: Math.min(10, Math.max(0, aiScore.score)), // Clamp to 0-10
        reasoning: aiScore.reasoning
      }
    })
    .filter((match): match is { templateSlug: string, templateName: string, score: number, reasoning: string } => match !== null)
    .sort((a, b) => b.score - a.score)

  return matches
}

/**
 * Generate reasoning text for why a template matches a document
 * (Deprecated - now using reasons from calculateBasicRelevance)
 */
function generateReasoningForTemplate(
  template: TemplateMetadata,
  doc: DocumentMetadata,
  score: number
): string {
  const reasons: string[] = []
  
  // Data type matches
  if (template.requiredDataTypes && doc.dataCategories) {
    const matches = template.requiredDataTypes.filter(req =>
      doc.dataCategories?.some(cat =>
        cat.toLowerCase().includes(req.toLowerCase()) ||
        req.toLowerCase().includes(cat.toLowerCase())
      )
    )
    if (matches.length > 0) {
      reasons.push(`Matches data types: ${matches.join(', ')}`)
    }
  }
  
  // Structure matches
  if (template.hasTables && doc.hasTables) {
    reasons.push('Both contain tables')
  }
  
  // Topic/entity overlap
  if (template.expectedEntities && doc.keyTopics) {
    const overlaps = template.expectedEntities.filter(entity =>
      doc.keyTopics?.some(topic =>
        topic.toLowerCase().includes(entity.toLowerCase()) ||
        entity.toLowerCase().includes(topic.toLowerCase())
      )
    )
    if (overlaps.length > 0) {
      reasons.push(`Topic overlap: ${overlaps.join(', ')}`)
    }
  }
  
  if (reasons.length === 0) {
    return score > 5 ? 'General compatibility' : 'Low compatibility'
  }
  
  return reasons.join('; ')
}
