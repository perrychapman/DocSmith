// frontend/src/components/TemplateMatchingJobs.tsx
import * as React from 'react'
import { Button } from './ui/Button'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { TemplateMatching } from '../lib/api'
import { toast } from 'sonner'
import { RefreshCw, X, PlayCircle, Loader2, CheckCircle2, XCircle, Clock, Trash2 } from 'lucide-react'

interface Job {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  templateSlugs?: string[]
  customerIds?: number[]
  forceRecalculate?: boolean
  totalDocuments: number
  processedDocuments: number
  matchedDocuments: number
  skippedDocuments: number
  startedAt?: string
  completedAt?: string
  error?: string
  createdBy?: string
}

interface TemplateMatchingJobsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TemplateMatchingJobs({ open, onOpenChange }: TemplateMatchingJobsProps) {
  const [jobs, setJobs] = React.useState<Job[]>([])
  const [loading, setLoading] = React.useState(false)
  const [polling, setPolling] = React.useState(false)
  const [hasDocuments, setHasDocuments] = React.useState<boolean>(true)
  const [checkingDocuments, setCheckingDocuments] = React.useState<boolean>(false)

  // Check if there are any documents with metadata in customer workspaces
  const checkForDocuments = React.useCallback(async () => {
    setCheckingDocuments(true)
    try {
      // Fetch customers
      const customersRes = await fetch('/api/customers')
      if (!customersRes.ok) {
        setHasDocuments(false)
        return
      }
      
      const customersData = await customersRes.json()
      const customers = Array.isArray(customersData?.customers) ? customersData.customers : []
      
      if (customers.length === 0) {
        setHasDocuments(false)
        return
      }

      // Check if any customer has documents with metadata
      let foundDocuments = false
      for (const customer of customers) {
        try {
          const uploadsRes = await fetch(`/api/customers/${customer.id}/uploads`)
          if (uploadsRes.ok) {
            const uploadsData = await uploadsRes.json()
            const uploads = Array.isArray(uploadsData?.uploads) ? uploadsData.uploads : []
            // Check if any upload has metadata
            const hasMetadata = uploads.some((u: any) => u.metadata && Object.keys(u.metadata).length > 0)
            if (hasMetadata) {
              foundDocuments = true
              break
            }
          }
        } catch {
          // Continue checking other customers
        }
      }
      
      setHasDocuments(foundDocuments)
    } catch (err) {
      console.error('Failed to check for documents:', err)
      setHasDocuments(false)
    } finally {
      setCheckingDocuments(false)
    }
  }, [])

  // Load jobs
  const loadJobs = React.useCallback(async () => {
    try {
      const response = await TemplateMatching.listJobs()
      if (response.success) {
        setJobs(response.jobs as Job[])
      }
    } catch (err) {
      console.error('Failed to load jobs:', err)
    }
  }, [])

  // Poll for updates on running jobs
  React.useEffect(() => {
    if (!polling) return

    const interval = setInterval(async () => {
      await loadJobs()
      
      // Stop polling if no running jobs
      const hasRunning = jobs.some(j => j.status === 'running' || j.status === 'pending')
      if (!hasRunning) {
        setPolling(false)
      }
    }, 2000) // Poll every 2 seconds

    return () => clearInterval(interval)
  }, [polling, jobs, loadJobs])

  // Load on mount
  React.useEffect(() => {
    if (open) {
      loadJobs()
      checkForDocuments()
    }
  }, [open, loadJobs, checkForDocuments])

  // Start recalculation for all templates
  const handleRecalculateAll = async (force: boolean = false) => {
    if (!hasDocuments) {
      toast.error('No documents with metadata found. Please add customers and extract document metadata first.')
      return
    }

    setLoading(true)
    try {
      const response = await TemplateMatching.startJob({
        forceRecalculate: force,
        createdBy: 'manual-ui'
      })
      
      if (response.success) {
        toast.success(`Matching job started: ${response.jobId}`)
        setPolling(true)
        await loadJobs()
      } else {
        toast.error('Failed to start job')
      }
    } catch (err) {
      toast.error('Failed to start recalculation')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Cancel a job
  const handleCancelJob = async (jobId: string) => {
    try {
      const response = await TemplateMatching.cancelJob(jobId)
      if (response.success) {
        toast.success('Job cancelled')
        await loadJobs()
      } else {
        toast.error('Failed to cancel job')
      }
    } catch (err) {
      toast.error('Failed to cancel job')
      console.error(err)
    }
  }

  // Clear all jobs
  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear all jobs? This will remove all job history.')) {
      return
    }

    setLoading(true)
    try {
      const response = await TemplateMatching.clearAllJobs()
      if (response.success) {
        toast.success(`Cleared ${response.count} job(s)`)
        setJobs([])
      } else {
        toast.error('Failed to clear jobs')
      }
    } catch (err) {
      toast.error('Failed to clear jobs')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Get status badge
  const getStatusBadge = (status: Job['status']) => {
    const configs = {
      pending: { icon: Clock, variant: 'secondary' as const, label: 'Pending' },
      running: { icon: Loader2, variant: 'default' as const, label: 'Running' },
      completed: { icon: CheckCircle2, variant: 'default' as const, label: 'Completed' },
      failed: { icon: XCircle, variant: 'destructive' as const, label: 'Failed' },
      cancelled: { icon: X, variant: 'secondary' as const, label: 'Cancelled' }
    }
    
    const config = configs[status]
    const Icon = config.icon
    
    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className={`h-3 w-3 ${status === 'running' ? 'animate-spin' : ''}`} />
        {config.label}
      </Badge>
    )
  }

  // Calculate progress percentage
  const getProgress = (job: Job): number => {
    if (job.totalDocuments === 0) return 0
    return Math.round((job.processedDocuments / job.totalDocuments) * 100)
  }

  // Format timestamp
  const formatTime = (iso?: string): string => {
    if (!iso) return 'N/A'
    const date = new Date(iso)
    return date.toLocaleString()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:!max-w-6xl">
        <DialogHeader>
          <DialogTitle>Template Matching Jobs</DialogTitle>
          <DialogDescription>
            Background jobs that calculate template relevance for documents
          </DialogDescription>
        </DialogHeader>
        
        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 pb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadJobs()}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRecalculateAll(false)}
            disabled={loading}
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Match New Only
          </Button>
          
          <Button
            variant="default"
            size="sm"
            onClick={() => handleRecalculateAll(true)}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Recalculate All
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            disabled={loading || jobs.length === 0}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear All
          </Button>
        </div>

        {/* Jobs list with scroll area */}
        <div className="h-[70vh] min-h-[480px]">
          <ScrollArea className="h-full">
            {jobs.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                <p>No matching jobs yet</p>
                <p className="text-sm mt-1">Start a job to calculate template relevance scores</p>
              </Card>
            ) : (
              <div className="space-y-3 pr-4">
          {jobs.map(job => (
            <Card key={job.id} className="p-4">
              <div className="space-y-3">
                {/* Job header */}
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {getStatusBadge(job.status)}
                      <span className="font-mono text-xs text-muted-foreground">{job.id}</span>
                    </div>
                    
                    {job.templateSlugs && job.templateSlugs.length > 0 && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Templates:</span>{' '}
                        {job.templateSlugs.join(', ')}
                      </div>
                    )}
                    
                    {job.customerIds && job.customerIds.length > 0 && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Customers:</span>{' '}
                        {job.customerIds.join(', ')}
                      </div>
                    )}
                    
                    {job.forceRecalculate && (
                      <Badge variant="outline" className="text-xs">
                        Force Recalculate
                      </Badge>
                    )}
                  </div>
                  
                  {(job.status === 'running' || job.status === 'pending') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancelJob(job.id)}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  )}
                </div>

                {/* Progress bar for running jobs */}
                {(job.status === 'running' || job.status === 'pending') && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Progress: {job.processedDocuments} / {job.totalDocuments} documents
                      </span>
                      <span className="font-medium">{getProgress(job)}%</span>
                    </div>
                    <Progress value={getProgress(job)} className="h-2" />
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Total</div>
                    <div className="font-medium">{job.totalDocuments}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Processed</div>
                    <div className="font-medium">{job.processedDocuments}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Matched</div>
                    <div className="font-medium text-green-600">{job.matchedDocuments}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Skipped</div>
                    <div className="font-medium text-blue-600">{job.skippedDocuments}</div>
                  </div>
                </div>

                {/* Timestamps */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
                  {job.startedAt && (
                    <span>Started: {formatTime(job.startedAt)}</span>
                  )}
                  {job.completedAt && (
                    <span>Completed: {formatTime(job.completedAt)}</span>
                  )}
                  {job.createdBy && (
                    <span>By: {job.createdBy}</span>
                  )}
                </div>

                {/* Error message */}
                {job.error && (
                  <div className="bg-destructive/10 text-destructive p-2 rounded text-sm">
                    <strong>Error:</strong> {job.error}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
