import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { libraryRoot } from './fs'

export type GenJobStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface GenJobStep {
  name: string
  status?: 'start'|'ok'|'error'
  startedAt?: string
  endedAt?: string
  durationMs?: number
}

export interface GenJobFile { path: string; name: string }

export interface GenJob {
  id: string
  customerId: number
  customerName?: string
  template: string
  filename?: string
  usedWorkspace?: string
  startedAt: string
  updatedAt: string
  completedAt?: string
  status: GenJobStatus
  logs: string[]
  file?: GenJobFile
  error?: string
  steps?: GenJobStep[]
  cancelled?: boolean
}

let jobs: GenJob[] = []
const MAX_JOBS = 200

const JOBS_DIR = path.join(libraryRoot(), '.jobs')
const JOBS_FILE = path.join(JOBS_DIR, 'jobs.json')

function ensureJobsDir() {
  try { fs.mkdirSync(JOBS_DIR, { recursive: true }) } catch {}
}

export function initJobs() {
  try {
    ensureJobsDir()
    if (fs.existsSync(JOBS_FILE)) {
      const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data)) jobs = data
    }
  } catch { jobs = [] }
}

function saveJobs() {
  try { ensureJobsDir(); fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8') } catch {}
}

export function createJob(input: { customerId: number; customerName?: string; template: string; filename?: string; usedWorkspace?: string }): GenJob {
  const now = new Date().toISOString()
  const job: GenJob = {
    id: randomUUID(),
    customerId: input.customerId,
    customerName: input.customerName,
    template: input.template,
    filename: input.filename,
    usedWorkspace: input.usedWorkspace,
    startedAt: now,
    updatedAt: now,
    status: 'running',
    logs: [],
  }
  jobs.unshift(job)
  if (jobs.length > MAX_JOBS) jobs.pop()
  saveJobs()
  return job
}

// Create a job with a client-provided ID (e.g., to enable cancellation from the UI immediately)
export function createJobWithId(input: { id: string; customerId: number; customerName?: string; template: string; filename?: string; usedWorkspace?: string }): GenJob {
  const now = new Date().toISOString()
  const job: GenJob = {
    id: input.id,
    customerId: input.customerId,
    customerName: input.customerName,
    template: input.template,
    filename: input.filename,
    usedWorkspace: input.usedWorkspace,
    startedAt: now,
    updatedAt: now,
    status: 'running',
    logs: [],
  }
  jobs.unshift(job)
  if (jobs.length > MAX_JOBS) jobs.pop()
  saveJobs()
  return job
}

export function appendLog(jobId: string, message: string) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  job.logs.push(message)
  job.updatedAt = new Date().toISOString()
  saveJobs()
}

export function markJobDone(jobId: string, file?: GenJobFile, meta?: { usedWorkspace?: string }) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  job.status = 'done'
  if (file) job.file = file
  if (meta?.usedWorkspace) job.usedWorkspace = meta.usedWorkspace
  job.updatedAt = new Date().toISOString()
  job.completedAt = job.updatedAt
  saveJobs()
}

export function markJobError(jobId: string, error: string) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  job.status = 'error'
  job.error = error
  job.updatedAt = new Date().toISOString()
  job.completedAt = job.updatedAt
  saveJobs()
}

export function setJobMeta(jobId: string, meta: Partial<Pick<GenJob, 'usedWorkspace' | 'filename'>>) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  if (meta.usedWorkspace) job.usedWorkspace = meta.usedWorkspace
  if (meta.filename) job.filename = meta.filename
  job.updatedAt = new Date().toISOString()
  saveJobs()
}

export function getJob(jobId: string): GenJob | undefined { return jobs.find(j => j.id === jobId) }

export function listJobs(limit = 50): GenJob[] { return jobs.slice(0, Math.max(0, Math.min(limit, jobs.length))) }

export function stepStart(jobId: string, name: string) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  job.steps = job.steps || []
  const now = new Date().toISOString()
  const existing = job.steps.find(s => s.name === name)
  if (existing) {
    existing.status = 'start'
    existing.startedAt = now
    existing.endedAt = undefined
    existing.durationMs = undefined
  } else {
    job.steps.push({ name, status: 'start', startedAt: now })
  }
  job.updatedAt = now
  saveJobs()
}

export function stepOk(jobId: string, name: string) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  job.steps = job.steps || []
  const now = new Date().toISOString()
  let s = job.steps.find(ss => ss.name === name)
  if (!s) { s = { name }; job.steps.push(s) }
  s.status = 'ok'
  s.endedAt = now
  if (s.startedAt) {
    try { s.durationMs = Math.max(0, new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) } catch {}
  }
  job.updatedAt = now
  saveJobs()
}

export function cancelJob(jobId: string) {
  const job = jobs.find(j => j.id === jobId)
  if (!job) return
  job.cancelled = true
  job.status = 'cancelled'
  job.updatedAt = new Date().toISOString()
  job.completedAt = job.updatedAt
  saveJobs()
}

export function isCancelled(jobId: string): boolean {
  const job = jobs.find(j => j.id === jobId)
  return !!job?.cancelled
}

export function deleteJob(jobId: string) {
  const idx = jobs.findIndex(j => j.id === jobId)
  if (idx >= 0) {
    jobs.splice(idx, 1)
    saveJobs()
  }
}

export function clearJobs() {
  jobs = []
  saveJobs()
}
