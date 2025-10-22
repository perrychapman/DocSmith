// backend/src/services/templateMatchingJobs.ts
import { getDB } from './storage'
import { loadAllDocumentMetadata, saveDocumentMetadata, type DocumentMetadata } from './documentMetadata'
import { loadTemplateMetadata, type TemplateMetadata, loadAllTemplateMetadata } from './templateMetadata'
import { calculateBasicRelevance, calculateDocumentTemplateRelevance } from './metadataMatching'
import { logInfo, logError } from '../utils/logger'

export interface TemplateMatchingJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  templateSlugs?: string[]  // If specified, only match these templates
  customerIds?: number[]     // If specified, only match documents from these customers
  forceRecalculate?: boolean // If true, recalculate even if scores exist
  totalDocuments: number
  processedDocuments: number
  matchedDocuments: number   // Documents that got new/updated scores
  skippedDocuments: number   // Documents that already had scores (if not forcing)
  startedAt?: string
  completedAt?: string
  error?: string
  createdBy?: string
}

// In-memory job tracking (for MVP - could be moved to DB for persistence)
const jobs = new Map<string, TemplateMatchingJob>()

/**
 * Create a new template matching job
 */
export function createMatchingJob(options: {
  templateSlugs?: string[]
  customerIds?: number[]
  forceRecalculate?: boolean
  createdBy?: string
}): string {
  const jobId = `tmj_${Date.now()}_${Math.random().toString(36).substring(7)}`
  
  const job: TemplateMatchingJob = {
    id: jobId,
    status: 'pending',
    templateSlugs: options.templateSlugs,
    customerIds: options.customerIds,
    forceRecalculate: options.forceRecalculate || false,
    totalDocuments: 0,
    processedDocuments: 0,
    matchedDocuments: 0,
    skippedDocuments: 0,
    createdBy: options.createdBy
  }
  
  jobs.set(jobId, job)
  logInfo(`[TEMPLATE-MATCHING-JOB] Created job ${jobId}`)
  
  return jobId
}

/**
 * Get job status
 */
export function getJobStatus(jobId: string): TemplateMatchingJob | null {
  return jobs.get(jobId) || null
}

/**
 * Get all jobs
 */
export function getAllJobs(): TemplateMatchingJob[] {
  return Array.from(jobs.values())
}

/**
 * Cancel a running job
 */
export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId)
  if (!job) return false
  
  if (job.status === 'running' || job.status === 'pending') {
    job.status = 'cancelled'
    job.completedAt = new Date().toISOString()
    logInfo(`[TEMPLATE-MATCHING-JOB] Cancelled job ${jobId}`)
    return true
  }
  
  return false
}

/**
 * Calculate template relevance for a single document against specified templates
 * Returns updated template relevance array (only for specified templates)
 * Uses AI-powered matching when workspace slug is provided
 */
async function calculateDocumentTemplateRelevanceForTemplates(
  docMetadata: DocumentMetadata,
  templates: TemplateMetadata[],
  workspaceSlug?: string
): Promise<Array<{ slug: string, name: string, score: number, reasoning: string }>> {
  
  // If workspace slug is provided, try AI-powered matching first
  if (workspaceSlug) {
    try {
      logInfo(`[TEMPLATE-MATCHING-JOB] Using AI-powered matching for document: ${docMetadata.filename}`)
      
      // Use the AI-powered function that matches against ALL templates
      const allScores = await calculateDocumentTemplateRelevance(docMetadata, workspaceSlug)
      
      // Filter to only the templates we're interested in
      const templateSlugs = new Set(templates.map(t => t.templateSlug))
      const filteredScores = allScores
        .filter(score => templateSlugs.has(score.templateSlug))
        .map(score => ({
          slug: score.templateSlug,
          name: score.templateName,
          score: score.score,
          reasoning: score.reasoning
        }))
      
      if (filteredScores.length > 0) {
        logInfo(`[TEMPLATE-MATCHING-JOB] AI matched ${filteredScores.length} templates for ${docMetadata.filename}`)
        return filteredScores.sort((a, b) => b.score - a.score)
      }
      
      logInfo(`[TEMPLATE-MATCHING-JOB] AI matching returned no results, falling back to rule-based`)
    } catch (err) {
      logError(`[TEMPLATE-MATCHING-JOB] AI matching failed, falling back to rule-based:`, err)
    }
  }
  
  // Fallback: Rule-based matching
  logInfo(`[TEMPLATE-MATCHING-JOB] Using rule-based matching for document: ${docMetadata.filename}`)
  const relevanceScores = templates.map(template => {
    const result = calculateBasicRelevance(template, docMetadata)
    const reasoning = result.reasons.join('; ') || (result.score > 5 ? 'General compatibility' : 'Low compatibility')
    
    return {
      slug: template.templateSlug,
      name: template.templateName,
      score: result.score,
      reasoning
    }
  })
  
  // Sort by score descending
  return relevanceScores.sort((a, b) => b.score - a.score)
}

/**
 * Merge new template scores into existing templateRelevance array
 * Replaces scores for specified templates, keeps others unchanged
 */
function mergeTemplateRelevance(
  existing: Array<{ slug: string, name: string, score: number, reasoning: string }> | undefined,
  newScores: Array<{ slug: string, name: string, score: number, reasoning: string }>
): Array<{ slug: string, name: string, score: number, reasoning: string }> {
  const existingMap = new Map((existing || []).map(t => [t.slug, t]))
  
  // Update/add new scores
  newScores.forEach(score => {
    existingMap.set(score.slug, score)
  })
  
  // Convert back to array and sort by score
  return Array.from(existingMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 20) // Keep top 20 templates
}

/**
 * Check if a document needs matching for the specified templates
 * Returns templates that need to be calculated (those missing from document's scores)
 */
function getTemplatesToCalculate(
  docMetadata: DocumentMetadata,
  templates: TemplateMetadata[]
): TemplateMetadata[] {
  const existingRelevance = docMetadata.extraFields?.templateRelevance as Array<{
    slug: string, name: string, score: number, reasoning: string
  }> | undefined
  
  if (!existingRelevance || existingRelevance.length === 0) {
    // No existing scores, need to calculate all
    return templates
  }
  
  const existingSlugs = new Set(existingRelevance.map(t => t.slug))
  
  // Only return templates that don't have scores yet
  return templates.filter(t => !existingSlugs.has(t.templateSlug))
}

/**
 * Get workspace slug for a customer
 */
async function getCustomerWorkspaceSlug(customerId: number): Promise<string | undefined> {
  const db = getDB()
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT workspaceSlug FROM customers WHERE id = ?',
      [customerId],
      (err, row: any) => {
        if (err) return reject(err)
        resolve(row?.workspaceSlug || undefined)
      }
    )
  })
}

/**
 * Process a template matching job
 * Runs in background, updates job status as it progresses
 */
export async function processMatchingJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) {
    logError(`[TEMPLATE-MATCHING-JOB] Job ${jobId} not found`)
    return
  }
  
  try {
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    logInfo(`[TEMPLATE-MATCHING-JOB] Starting job ${jobId}`)
    
    // Load templates to match against
    let templates: TemplateMetadata[]
    if (job.templateSlugs && job.templateSlugs.length > 0) {
      // Load specific templates
      const templatePromises = job.templateSlugs.map(slug => loadTemplateMetadata(slug))
      const loadedTemplates = await Promise.all(templatePromises)
      templates = loadedTemplates.filter(t => t !== null) as TemplateMetadata[]
      logInfo(`[TEMPLATE-MATCHING-JOB] Loaded ${templates.length} specified templates`)
    } else {
      // Load all templates
      templates = await loadAllTemplateMetadata()
      logInfo(`[TEMPLATE-MATCHING-JOB] Loaded ${templates.length} templates from database`)
    }
    
    if (templates.length === 0) {
      throw new Error('No templates available for matching')
    }
    
    // Get all documents to process
    const db = getDB()
    let documents: DocumentMetadata[] = []
    
    if (job.customerIds && job.customerIds.length > 0) {
      // Load documents from specific customers
      for (const customerId of job.customerIds) {
        const customerDocs = await loadAllDocumentMetadata(customerId)
        documents.push(...customerDocs)
      }
      logInfo(`[TEMPLATE-MATCHING-JOB] Loaded ${documents.length} documents from ${job.customerIds.length} customers`)
    } else {
      // Load all documents across all customers
      documents = await new Promise((resolve, reject) => {
        db.all(
          `SELECT * FROM document_metadata ORDER BY customerId, filename`,
          [],
          async (err, rows: any[]) => {
            if (err) return reject(err)
            
            const docs = rows.map((row: any) => {
              try {
                const doc: DocumentMetadata = {
                  id: row.id,
                  customerId: row.customerId,
                  filename: row.filename,
                  uploadedAt: row.uploadedAt,
                  fileSize: row.fileSize,
                  documentType: row.documentType,
                  purpose: row.purpose,
                  keyTopics: row.keyTopics ? JSON.parse(row.keyTopics) : undefined,
                  stakeholders: row.stakeholders ? JSON.parse(row.stakeholders) : undefined,
                  dateRange: row.dateRange,
                  dataCategories: row.dataCategories ? JSON.parse(row.dataCategories) : undefined,
                  hasTables: row.hasTables === 1,
                  meetingDate: row.meetingDate,
                  relatedDocuments: row.relatedDocuments ? JSON.parse(row.relatedDocuments) : undefined,
                  lastAnalyzed: row.lastAnalyzed,
                  analysisVersion: row.analysisVersion,
                  extraFields: row.extraFields ? JSON.parse(row.extraFields) : {}
                }
                return doc
              } catch (parseErr) {
                logError(`[TEMPLATE-MATCHING-JOB] Error parsing document metadata:`, parseErr)
                return null
              }
            }).filter((doc: DocumentMetadata | null): doc is DocumentMetadata => doc !== null)
            
            resolve(docs)
          }
        )
      })
      logInfo(`[TEMPLATE-MATCHING-JOB] Loaded ${documents.length} documents from all customers`)
    }
    
    job.totalDocuments = documents.length
    
    // Build a map of customer IDs to workspace slugs for AI matching
    const customerWorkspaces = new Map<number, string | undefined>()
    const uniqueCustomerIds = [...new Set(documents.map(d => d.customerId))]
    
    logInfo(`[TEMPLATE-MATCHING-JOB] Fetching workspace slugs for ${uniqueCustomerIds.length} customers`)
    await Promise.all(
      uniqueCustomerIds.map(async (customerId) => {
        try {
          const workspaceSlug = await getCustomerWorkspaceSlug(customerId)
          if (workspaceSlug) {
            customerWorkspaces.set(customerId, workspaceSlug)
            logInfo(`[TEMPLATE-MATCHING-JOB] Customer ${customerId} has workspace: ${workspaceSlug}`)
          } else {
            logInfo(`[TEMPLATE-MATCHING-JOB] Customer ${customerId} has no workspace configured`)
          }
        } catch (err) {
          logError(`[TEMPLATE-MATCHING-JOB] Failed to fetch workspace for customer ${customerId}:`, err)
        }
      })
    )
    
    logInfo(`[TEMPLATE-MATCHING-JOB] Found ${customerWorkspaces.size} customers with workspaces (will use AI matching)`)
    logInfo(`[TEMPLATE-MATCHING-JOB] ${uniqueCustomerIds.length - customerWorkspaces.size} customers without workspaces (will use rule-based matching)`)
    
    // Process documents in batches
    const batchSize = 10  // Process 10 documents at a time
    let matchedCount = 0
    
    for (let i = 0; i < documents.length; i += batchSize) {
      // Check if job was cancelled (read fresh status from map)
      const currentJob = jobs.get(jobId)
      if (currentJob && currentJob.status === 'cancelled') {
        logInfo(`[TEMPLATE-MATCHING-JOB] Job ${jobId} was cancelled at document ${i}/${documents.length}`)
        return
      }
      
      const batch = documents.slice(i, i + batchSize)
      
      // Process batch in parallel
      await Promise.all(batch.map(async (doc) => {
        try {
          // Check which templates need calculation (unless forcing recalculation)
          const templatesToCalculate = job.forceRecalculate 
            ? templates 
            : getTemplatesToCalculate(doc, templates)
          
          if (templatesToCalculate.length === 0) {
            // Document already has scores for all specified templates, skip
            job.skippedDocuments++
            return
          }
          
          // Get workspace slug for this customer (for AI matching)
          const workspaceSlug = customerWorkspaces.get(doc.customerId)
          
          // Calculate relevance for templates that need it (with AI if workspace available)
          const newScores = await calculateDocumentTemplateRelevanceForTemplates(
            doc, 
            templatesToCalculate,
            workspaceSlug
          )
          
          // Merge with existing template relevance
          const existingRelevance = doc.extraFields?.templateRelevance as Array<{
            slug: string, name: string, score: number, reasoning: string
          }> | undefined
          
          const mergedRelevance = mergeTemplateRelevance(existingRelevance, newScores)
          
          // Update document metadata with new scores
          doc.extraFields = doc.extraFields || {}
          doc.extraFields.templateRelevance = mergedRelevance
          
          // Save updated metadata (pass workspaceSlug to avoid recalculation)
          await saveDocumentMetadata(doc.customerId, doc, workspaceSlug)
          
          matchedCount++
          
        } catch (err) {
          logError(`[TEMPLATE-MATCHING-JOB] Error processing document ${doc.filename}:`, err)
          // Continue with other documents
        }
      }))
      
      job.processedDocuments = Math.min(i + batchSize, documents.length)
      job.matchedDocuments = matchedCount
      
      // Small delay between batches to avoid overwhelming the system
      if (i + batchSize < documents.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      const skipped = job.skippedDocuments
      logInfo(`[TEMPLATE-MATCHING-JOB] Progress: ${job.processedDocuments}/${job.totalDocuments} documents (${matchedCount} updated, ${skipped} skipped)`)
    }
    
    job.status = 'completed'
    job.completedAt = new Date().toISOString()
    logInfo(`[TEMPLATE-MATCHING-JOB] Job ${jobId} completed: ${matchedCount}/${documents.length} documents updated, ${job.skippedDocuments} skipped`)
    
  } catch (err) {
    job.status = 'failed'
    job.completedAt = new Date().toISOString()
    job.error = (err as Error).message
    logError(`[TEMPLATE-MATCHING-JOB] Job ${jobId} failed:`, err)
  }
}

/**
 * Start a new template matching job in background
 */
export function startMatchingJobInBackground(options: {
  templateSlugs?: string[]
  customerIds?: number[]
  forceRecalculate?: boolean
  createdBy?: string
}): string {
  const jobId = createMatchingJob(options)
  
  // Start processing in background (non-blocking)
  processMatchingJob(jobId).catch(err => {
    logError(`[TEMPLATE-MATCHING-JOB] Background job ${jobId} error:`, err)
  })
  
  return jobId
}

/**
 * Clean up old completed/failed jobs (keep last 50)
 */
export function cleanupOldJobs(): void {
  const allJobs = Array.from(jobs.entries())
  const completedJobs = allJobs
    .filter(([_, job]) => job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')
    .sort((a, b) => {
      const aTime = a[1].completedAt || a[1].startedAt || ''
      const bTime = b[1].completedAt || b[1].startedAt || ''
      return bTime.localeCompare(aTime) // Newest first
    })
  
  if (completedJobs.length > 50) {
    const toDelete = completedJobs.slice(50)
    toDelete.forEach(([jobId]) => {
      jobs.delete(jobId)
    })
    logInfo(`[TEMPLATE-MATCHING-JOB] Cleaned up ${toDelete.length} old jobs`)
  }
}

/**
 * Clear all jobs from memory
 * WARNING: This will remove all job history
 */
export function clearAllJobs(): number {
  const count = jobs.size
  jobs.clear()
  logInfo(`[TEMPLATE-MATCHING-JOB] Cleared all ${count} jobs`)
  return count
}
