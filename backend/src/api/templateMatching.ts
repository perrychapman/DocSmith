// backend/src/api/templateMatching.ts
import { Router } from 'express'
import {
  startMatchingJobInBackground,
  getJobStatus,
  getAllJobs,
  cancelJob,
  cleanupOldJobs,
  clearAllJobs,
  type TemplateMatchingJob
} from '../services/templateMatchingJobs'
import { logInfo, logError } from '../utils/logger'

const router = Router()

/**
 * POST /api/template-matching/jobs
 * Start a new template matching job
 * 
 * Body:
 * {
 *   templateSlugs?: string[]    // If specified, only match these templates
 *   customerIds?: number[]       // If specified, only match documents from these customers
 *   forceRecalculate?: boolean   // If true, recalculate even if scores already exist
 *   createdBy?: string
 * }
 */
router.post('/jobs', async (req, res) => {
  try {
    const { templateSlugs, customerIds, forceRecalculate, createdBy } = req.body
    
    logInfo(`[TEMPLATE-MATCHING-API] Starting matching job with templates: ${templateSlugs?.join(', ') || 'all'}, customers: ${customerIds?.join(', ') || 'all'}, force: ${forceRecalculate || false}`)
    
    const jobId = startMatchingJobInBackground({
      templateSlugs,
      customerIds,
      forceRecalculate,
      createdBy
    })
    
    // Clean up old jobs periodically
    cleanupOldJobs()
    
    res.json({
      success: true,
      jobId,
      message: 'Template matching job started'
    })
  } catch (err) {
    logError('[TEMPLATE-MATCHING-API] Error starting job:', err)
    res.status(500).json({
      success: false,
      error: (err as Error).message
    })
  }
})

/**
 * GET /api/template-matching/jobs/:jobId
 * Get status of a specific job
 */
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params
    
    const job = getJobStatus(jobId)
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      })
    }
    
    res.json({
      success: true,
      job
    })
  } catch (err) {
    logError('[TEMPLATE-MATCHING-API] Error getting job status:', err)
    res.status(500).json({
      success: false,
      error: (err as Error).message
    })
  }
})

/**
 * GET /api/template-matching/jobs
 * Get all jobs
 */
router.get('/jobs', async (req, res) => {
  try {
    const jobs = getAllJobs()
    
    // Sort by creation time (newest first)
    const sorted = jobs.sort((a, b) => {
      const aTime = a.startedAt || ''
      const bTime = b.startedAt || ''
      return bTime.localeCompare(aTime)
    })
    
    res.json({
      success: true,
      jobs: sorted
    })
  } catch (err) {
    logError('[TEMPLATE-MATCHING-API] Error getting jobs:', err)
    res.status(500).json({
      success: false,
      error: (err as Error).message
    })
  }
})

/**
 * DELETE /api/template-matching/jobs/:jobId
 * Cancel a running job
 */
router.delete('/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params
    
    const cancelled = cancelJob(jobId)
    
    if (!cancelled) {
      return res.status(400).json({
        success: false,
        error: 'Job cannot be cancelled (not found or already completed)'
      })
    }
    
    res.json({
      success: true,
      message: 'Job cancelled successfully'
    })
  } catch (err) {
    logError('[TEMPLATE-MATCHING-API] Error cancelling job:', err)
    res.status(500).json({
      success: false,
      error: (err as Error).message
    })
  }
})

/**
 * POST /api/template-matching/recalculate-all
 * Convenience endpoint to recalculate ALL template matches for ALL documents
 * WARNING: This can be very resource-intensive for large datasets
 */
router.post('/recalculate-all', async (req, res) => {
  try {
    logInfo(`[TEMPLATE-MATCHING-API] Starting full recalculation`)
    
    const jobId = startMatchingJobInBackground({
      createdBy: req.body.createdBy || 'manual-recalculation'
    })
    
    cleanupOldJobs()
    
    res.json({
      success: true,
      jobId,
      message: 'Full recalculation started',
      warning: 'This may take a while for large datasets. Check job status for progress.'
    })
  } catch (err) {
    logError('[TEMPLATE-MATCHING-API] Error starting full recalculation:', err)
    res.status(500).json({
      success: false,
      error: (err as Error).message
    })
  }
})

/**
 * POST /api/template-matching/match-template
 * Recalculate matches for a specific template across all documents
 */
router.post('/match-template', async (req, res) => {
  try {
    const { templateSlug } = req.body
    
    if (!templateSlug) {
      return res.status(400).json({
        success: false,
        error: 'templateSlug is required'
      })
    }
    
    logInfo(`[TEMPLATE-MATCHING-API] Starting matching for template: ${templateSlug}`)
    
    const jobId = startMatchingJobInBackground({
      templateSlugs: [templateSlug],
      createdBy: req.body.createdBy || 'template-specific-match'
    })
    
    cleanupOldJobs()
    
    res.json({
      success: true,
      jobId,
      message: `Matching job started for template: ${templateSlug}`
    })
  } catch (err) {
    logError('[TEMPLATE-MATCHING-API] Error starting template matching:', err)
    res.status(500).json({
      success: false,
      error: (err as Error).message
    })
  }
})

/**
 * DELETE /api/template-matching/jobs
 * Clear all jobs from memory
 * WARNING: This will remove all job history
 */
router.delete('/jobs', async (req, res) => {
  try {
    logInfo(`[TEMPLATE-MATCHING-API] Clearing all jobs`)
    
    const count = clearAllJobs()
    
    res.json({
      success: true,
      message: `Cleared ${count} job(s)`,
      count
    })
  } catch (err) {
    logError('[TEMPLATE-MATCHING-API] Error clearing jobs:', err)
    res.status(500).json({
      success: false,
      error: (err as Error).message
    })
  }
})

export default router
