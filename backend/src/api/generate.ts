// backend/src/api/generate.ts
import { Router } from "express"
import fs from "fs"
import path from "path"
import { getDB } from "../services/storage"
import { renderTemplate, loadTemplate } from "../services/templateEngine"
import { mergeHtmlIntoDocxTemplate } from "../services/docxCompose"
import { ensureDocumentsDir, resolveCustomerPaths } from "../services/customerLibrary"
import { libraryRoot, safeFileName, displayNameFromSlug } from "../services/fs"
import { anythingllmRequest } from "../services/anythingllm"
import { createJob, createJobWithId, appendLog as jobLog, markJobDone, markJobError, setJobMeta, listJobs, getJob, stepStart as jobStepStart, stepOk as jobStepOk, cancelJob, isCancelled, initJobs, deleteJob, clearJobs } from "../services/genJobs"
import child_process from 'child_process'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Handlebars = require('handlebars')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ts = require('typescript')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vm = require('vm')
const mammoth = require('mammoth')
const { marked } = require('marked')
const htmlToDocx = require('html-to-docx')
// placeholder-based DOCX operations removed

initJobs()
const router = Router()

const TEMPLATES_ROOT = path.join(libraryRoot(), "templates")

type Body = { customerId?: number; template?: string; filename?: string; data?: any; embed?: boolean; refresh?: boolean; jobId?: string }

router.post("/", async (req, res) => {
  const { customerId, template: slug, filename, data, embed, refresh, jobId } = (req.body || {}) as Body
  if (!customerId || !slug) return res.status(400).json({ error: "customerId and template are required" })

  const db = getDB()
  db.get<{ id: number; name: string; createdAt: string; workspaceSlug?: string | null }>(
    "SELECT id, name, createdAt, workspaceSlug FROM customers WHERE id = ?",
    [customerId],
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })

      try {
        const tpl = loadTemplate(String(slug), TEMPLATES_ROOT)
        if (!tpl) return res.status(404).json({ error: "Template not found" })
        const docsDir = ensureDocumentsDir(row.id, row.name, new Date(row.createdAt))

        // Build initial context
        const context: any = { customer: { id: row.id, name: row.name }, now: new Date().toISOString(), ...(data || {}) }

        // Enforce single-path generation via generator.full.ts producing raw WML
        let usedWorkspace: string | undefined
        const logs: string[] = []
        try {
          // Prefer customer's workspace; do not rely on template.json
          let wsSlug: string | undefined = row.workspaceSlug ? String(row.workspaceSlug) : undefined
          const fullGenPath = path.join(tpl.dir, 'generator.full.ts')
          // Require full generator for all outputs
          if (fs.existsSync(fullGenPath)) {
            try {
              const wsForGen = row.workspaceSlug || wsSlug
              if (!wsForGen) {
                return res.status(400).json({ error: 'Customer workspace is required to generate. Please attach a workspace to this customer.' })
              }
              usedWorkspace = wsForGen
              // Create a job record (allow client-provided id for immediate cancel capability)
              const job = jobId && String(jobId).trim().length > 0
                ? createJobWithId({ id: String(jobId), customerId: row.id, customerName: row.name, template: slug as string, filename, usedWorkspace: wsForGen })
                : createJob({ customerId: row.id, customerName: row.name, template: slug as string, filename, usedWorkspace: wsForGen })
              const logAndPush = (m: string) => { try { jobLog(job.id, m) } catch {} }
              const stepStartRec = (n: string) => { try { jobStepStart(job.id, n) } catch {} }
              const stepOkRec = (n: string) => { try { jobStepOk(job.id, n) } catch {} }
              let tsCode = fs.readFileSync(fullGenPath, 'utf-8')
              stepOkRec('readGenerator')

              // Cache AI-modified generator per-template per-workspace to reduce latency
              const cacheDir = path.join((tpl as any).dir, '.cache')
              try { fs.mkdirSync(cacheDir, { recursive: true }) } catch {}
              const cacheFile = path.join(cacheDir, `generator.full.${wsForGen}.ts`)
              const genStat = (()=>{ try { return fs.statSync(fullGenPath) } catch { return null } })()
              const cacheStat = (()=>{ try { return fs.statSync(cacheFile) } catch { return null } })()
              const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes
              const cacheFresh = !!(cacheStat && (Date.now() - cacheStat.mtimeMs) < CACHE_TTL_MS)
              const cacheUpToDate = !!(cacheStat && genStat && cacheStat.mtimeMs >= genStat.mtimeMs)
              // Default behavior: refresh each run unless explicitly disabled
              const forceRefresh = refresh !== false
              if (!forceRefresh && cacheFresh && cacheUpToDate) {
                try {
                  tsCode = fs.readFileSync(cacheFile, 'utf-8')
                  logs.push('ai-cache:hit')
                  logAndPush('ai-cache:hit')
                } catch {}
              }

              // Ask the AI (customer workspace) to update the generator code to use workspace data
              try {
                if (forceRefresh || !(logs.includes('ai-cache:hit'))) {
                const aiPrompt = `You are a senior TypeScript engineer. Update the following DocSmith generator function to incorporate customer-specific data from THIS WORKSPACE. Keep the EXACT export signature. Compose the final output as raw WordprocessingML (WML) via return { wml }. Do not import external modules or do file I/O. Maintain formatting with runs (color/size/bold/italic/underline/strike/font) and paragraph props (align/spacing/indents).\n\nSTRICT CONSTRAINTS:\n- PRESERVE ALL EXISTING WML STRUCTURE AND STYLING from the CURRENT GENERATOR CODE: do not alter fonts, colors, sizes, spacing, numbering, table properties, headers/footers, or section settings.\n- ONLY substitute text content (and list/table cell values) with workspace-derived strings.\n- DO NOT add, remove, or reorder sections/paragraphs/tables/runs unless absolutely necessary. If no data is found, keep the section and leave values empty rather than inventing content.\n- No boilerplate or extra headings; do not add content beyond what the template structure implies.\n- IMPORTANT: At runtime, toolkit.json/query/text are DISABLED. Do not rely on them. Encode all workspace-informed content directly in the returned WML or via the provided context parameter.\n- Use minimal LLM calls (within this single update).\n\nOnly output TypeScript code with the updated generate implementation.\n\nCURRENT GENERATOR CODE:\n\n\`\`\`ts\n${tsCode}\n\`\`\``
                stepStartRec('aiUpdate')
                const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(wsForGen)}/chat`, 'POST', { message: aiPrompt, mode: 'query' })
                const t = String(r?.textResponse || r?.message || r || '')
                const m = t.match(/```[a-z]*\s*([\s\S]*?)```/i)
                const codeOut = (m && m[1]) ? m[1] : t
                if (!codeOut || !/export\s+async\s+function\s+generate\s*\(/.test(codeOut)) throw new Error('AI did not return a valid generate function')
                tsCode = codeOut.trim()
                logs.push('ai-modified:ok')
                logAndPush('ai-modified:ok')
                stepOkRec('aiUpdate')
                try { fs.writeFileSync(cacheFile, tsCode, 'utf-8') } catch {}
                } else {
                  logs.push('ai-cache:used')
                  logAndPush('ai-cache:used')
                }
              } catch (e:any) {
                const errMsg = `AI could not update generator: ${e?.message || e}`
                logAndPush(`error:${errMsg}`)
                markJobError(job.id, errMsg)
                return res.status(502).json({ error: errMsg, jobId: job.id })
              }
              if (isCancelled(job.id)) { logAndPush('cancelled'); return res.status(499).json({ error: 'cancelled', jobId: job.id }) }
              const jsOut = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } })
              const sandbox: any = { module: { exports: {} }, console }
              // Ensure `exports` references `module.exports` like Node's wrapper
              ;(sandbox as any).exports = (sandbox as any).module.exports
              vm.createContext(sandbox)
              const wrapped = `(function (module, exports) { ${jsOut.outputText}\n;return module.exports; })`
              const fn = vm.runInContext(wrapped, sandbox)
              const mod = fn(sandbox.module, (sandbox as any).module.exports)
              let generateFull = mod?.generate
              if (typeof mod === 'function') {
                generateFull = mod as any
              }
              if (typeof generateFull !== 'function' && typeof (mod as any)?.default === 'function') {
                generateFull = (mod as any).default
              }
              if (typeof generateFull !== 'function' && (mod as any)?.default && typeof (mod as any).default.generate === 'function') {
                generateFull = (mod as any).default.generate
              }
              if (typeof generateFull !== 'function') {
                try { logs.push(`exportsKeys:${Object.keys(mod||{}).join(',')}`) } catch {}
                logAndPush('error:generate-missing')
                markJobError(job.id, 'generate function missing')
                return res.status(502).json({ error: 'generate function missing', jobId: job.id })
              }
              if (typeof generateFull === 'function') {
                if (isCancelled(job.id)) { logAndPush('cancelled'); return res.status(499).json({ error: 'cancelled', jobId: job.id }) }
                // Minimal DOCX builder API (available but not used as an output path)
                const docxLib = require('docx')
                const {
                  Document,
                  Packer,
                  Paragraph,
                  HeadingLevel,
                  TextRun,
                  Table,
                  TableRow,
                  TableCell,
                  WidthType,
                  AlignmentType,
                  UnderlineType,
                } = docxLib
                const doc = new Document({ sections: [{ properties: {}, children: [] }] })
                const children: any[] = (doc as any).Sections[0].properties.children || (doc as any).sections?.[0]?.children || []
                const builderUsed = { used: false }
                const normColor = (c?: any): string | undefined => {
                  if (!c) return undefined
                  let s = String(c).trim()
                  if (/^#?[0-9a-fA-F]{6}$/.test(s)) return s.replace(/^#/, '').toUpperCase()
                  const m = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
                  if (m) {
                    const r = Math.max(0, Math.min(255, parseInt(m[1]!,10)))
                    const g = Math.max(0, Math.min(255, parseInt(m[2]!,10)))
                    const b = Math.max(0, Math.min(255, parseInt(m[3]!,10)))
                    return [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase()
                  }
                  return undefined
                }
                const toHalfPoints = (v?: any): number | undefined => {
                  if (v == null) return undefined
                  if (typeof v === 'number' && isFinite(v)) return Math.round(v * 2)
                  const s = String(v).trim()
                  const m = s.match(/^(\d+(?:\.\d+)?)\s*pt$/i)
                  if (m) return Math.round(parseFloat(m[1]!)*2)
                  const n = Number(s)
                  return isFinite(n) ? Math.round(n*2) : undefined
                }
                const toAlignment = (a?: any) => {
                  const s = String(a||'').toLowerCase()
                  if (s === 'center' || s === 'centre') return AlignmentType.CENTER
                  if (s === 'right') return AlignmentType.RIGHT
                  if (s === 'justify' || s === 'justified') return AlignmentType.JUSTIFIED
                  if (s === 'left') return AlignmentType.LEFT
                  return undefined
                }
                const makeRuns = (runs?: any[]): any[] | undefined => {
                  if (!Array.isArray(runs)) return undefined
                  return runs.map(r => new TextRun({
                    text: String(r?.text ?? ''),
                    bold: !!r?.bold,
                    italics: !!r?.italic || !!r?.italics,
                    underline: r?.underline ? (typeof r?.underline === 'string' ? r?.underline : UnderlineType.SINGLE) : undefined,
                    color: normColor(r?.color),
                    size: toHalfPoints(r?.size ?? r?.sizePt),
                    font: r?.font || r?.family,
                    strike: !!r?.strike || !!r?.strikethrough,
                  }))
                }
                const builder = {
                  addHeading: (text: string, level: 1|2|3|4|5|6 = 1, opts?: any) => {
                    builderUsed.used = true
                    const lvlMap: any = {1: HeadingLevel.HEADING_1,2: HeadingLevel.HEADING_2,3: HeadingLevel.HEADING_3,4: HeadingLevel.HEADING_4,5: HeadingLevel.HEADING_5,6: HeadingLevel.HEADING_6}
                    const childrenRuns = makeRuns(opts?.runs) || [ new TextRun({
                      text: String(text||''),
                      bold: !!opts?.bold,
                      italics: !!opts?.italic || !!opts?.italics,
                      underline: opts?.underline ? (typeof opts?.underline === 'string' ? opts?.underline : UnderlineType.SINGLE) : undefined,
                      color: normColor(opts?.color),
                      size: toHalfPoints(opts?.size ?? opts?.sizePt),
                      font: opts?.font || opts?.family,
                      strike: !!opts?.strike || !!opts?.strikethrough,
                    }) ]
                    const p = new Paragraph({
                      heading: lvlMap[level] || HeadingLevel.HEADING_1,
                      alignment: toAlignment(opts?.align),
                      style: opts?.style,
                      spacing: opts?.spacing ? { before: opts?.spacing?.before, after: opts?.spacing?.after, line: opts?.spacing?.line } : undefined,
                      keepWithNext: !!opts?.keepWithNext,
                      children: childrenRuns,
                    })
                    children.push(p)
                  },
                  addParagraph: (text: string, opts?: any) => {
                    builderUsed.used = true
                    const childrenRuns = makeRuns(opts?.runs) || [ new TextRun({
                      text: String(text||''),
                      bold: !!opts?.bold,
                      italics: !!opts?.italic || !!opts?.italics,
                      underline: opts?.underline ? (typeof opts?.underline === 'string' ? opts?.underline : UnderlineType.SINGLE) : undefined,
                      color: normColor(opts?.color),
                      size: toHalfPoints(opts?.size ?? opts?.sizePt),
                      font: opts?.font || opts?.family,
                      strike: !!opts?.strike || !!opts?.strikethrough,
                    }) ]
                    const p = new Paragraph({
                      alignment: toAlignment(opts?.align),
                      style: opts?.style,
                      spacing: opts?.spacing ? { before: opts?.spacing?.before, after: opts?.spacing?.after, line: opts?.spacing?.line } : undefined,
                      indent: opts?.indent ? { left: opts?.indent?.left, right: opts?.indent?.right, firstLine: opts?.indent?.firstLine, hanging: opts?.indent?.hanging } : undefined,
                      keepWithNext: !!opts?.keepWithNext,
                      children: childrenRuns,
                    })
                    children.push(p)
                  },
                  addBulletList: (items: string[], opts?: any) => {
                    builderUsed.used = true
                    for (const it of (items||[])) {
                      const p = new Paragraph({
                        alignment: toAlignment(opts?.align),
                        bullet: { level: 0 },
                        children: [ new TextRun({
                          text: String(it||''),
                          bold: !!opts?.bold,
                          italics: !!opts?.italic || !!opts?.italics,
                          underline: opts?.underline ? (typeof opts?.underline === 'string' ? opts?.underline : UnderlineType.SINGLE) : undefined,
                          color: normColor(opts?.color),
                          size: toHalfPoints(opts?.size ?? opts?.sizePt),
                          font: opts?.font || opts?.family,
                          strike: !!opts?.strike || !!opts?.strikethrough,
                        }) ]
                      })
                      children.push(p)
                    }
                  },
                  addNumberedList: (items: string[], opts?: any) => {
                    builderUsed.used = true
                    // Note: Using basic numbering; underlying template merge preserves numbering styles if present
                    for (const it of (items||[])) {
                      const p = new Paragraph({
                        alignment: toAlignment(opts?.align),
                        numbering: { reference: 'num-default', level: 0 },
                        children: [ new TextRun({
                          text: String(it||''),
                          bold: !!opts?.bold,
                          italics: !!opts?.italic || !!opts?.italics,
                          underline: opts?.underline ? (typeof opts?.underline === 'string' ? opts?.underline : UnderlineType.SINGLE) : undefined,
                          color: normColor(opts?.color),
                          size: toHalfPoints(opts?.size ?? opts?.sizePt),
                          font: opts?.font || opts?.family,
                          strike: !!opts?.strike || !!opts?.strikethrough,
                        }) ]
                      })
                      children.push(p)
                    }
                  },
                  addTable: (rows: Array<string[]>, opts?: any) => {
                    builderUsed.used = true
                    const widths: number[] = Array.isArray(opts?.widthsPct) ? (opts.widthsPct as number[]) : []
                    const tRows = (rows||[]).map(r => new TableRow({
                      children: (r||[]).map((c, idx) => new TableCell({
                        width: (widths[idx] && isFinite(widths[idx]!)) ? { size: Math.max(1, Math.min(100, Math.floor(widths[idx]!))), type: WidthType.PERCENTAGE } : undefined,
                        children: [ new Paragraph({ children: [ new TextRun(String(c||'')) ] }) ]
                      }))
                    }))
                    const widthPct = (typeof opts?.widthPct === 'number') ? Math.max(1, Math.min(100, Math.floor(opts.widthPct))) : 100
                    const tbl = new Table({ rows: tRows, width: { size: widthPct, type: WidthType.PERCENTAGE }, style: opts?.style })
                    children.push(tbl)
                  },
                  pageBreak: () => { builderUsed.used = true; children.push(new Paragraph({ children: [], pageBreakBefore: true })) },
                  save: async (): Promise<Uint8Array> => {
                    // @ts-ignore
                    return await Packer.toUint8Array(new Document({ sections: [{ properties: {}, children }] }))
                  }
                }
                const toolkit = {
                  json: async (_prompt: string) => { throw new Error('Runtime AI disabled: toolkit.json unavailable') },
                  query: async (_prompt: string) => { throw new Error('Runtime AI disabled: toolkit.query unavailable') },
                  text: async (_prompt: string) => { throw new Error('Runtime AI disabled: toolkit.text unavailable') },
                  getSkeleton: async (kind?: 'html'|'text') => {
                    try {
                      const buffer = fs.readFileSync((tpl as any).templatePath)
                      if (kind === 'html' || !kind) {
                        const result = await (mammoth as any).convertToHtml({ buffer }, { styleMap: [
                          "p[style-name='Title'] => h1:fresh",
                          "p[style-name='Subtitle'] => h2:fresh",
                          "p[style-name='Heading 1'] => h1:fresh",
                          "p[style-name='Heading 2'] => h2:fresh",
                          "p[style-name='Heading 3'] => h3:fresh"
                        ] })
                        return String(result?.value || '')
                      } else {
                        const result = await (mammoth as any).extractRawText({ buffer })
                        return String(result?.value || '')
                      }
                    } catch { return '' }
                  },
                  markdownToHtml: (md: string) => (marked as any).parse(String(md || '')) as string,
                  htmlToDocx: async (html: string) => { return await (htmlToDocx as any)(String(html || '')) }
                }
                if (isCancelled(job.id)) { logAndPush('cancelled'); return res.status(499).json({ error: 'cancelled', jobId: job.id }) }
                const result = await generateFull(toolkit, builder, context)
                if ((tpl as any).kind !== 'docx') { markJobError(job.id, 'Template must be DOCX for WML merge'); return res.status(400).json({ error: 'Template must be DOCX for WML merge', jobId: job.id }) }
                if (!result || (!('wml' in (result as any)) && !('bodyXml' in (result as any)))) {
                  logAndPush('error:no-wml')
                  markJobError(job.id, 'Full generator did not return WML/bodyXml')
                  return res.status(502).json({ error: 'Full generator did not return WML/bodyXml', jobId: job.id })
                }
                const inner = String((result as any).wml || (result as any).bodyXml || '')
                if (isCancelled(job.id)) { logAndPush('cancelled'); return res.status(499).json({ error: 'cancelled', jobId: job.id }) }
                const merged = (await import('../services/docxCompose')).mergeWmlIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), inner)
                // Default filename: {Customer}_{TemplateName}_{YYYYMMDD_HHmmss}
                const dt = new Date()
                const dtStr = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}_${String(dt.getHours()).padStart(2,'0')}${String(dt.getMinutes()).padStart(2,'0')}${String(dt.getSeconds()).padStart(2,'0')}`
                const templateName = safeFileName(String(displayNameFromSlug(String(slug))))
                const customerName = safeFileName(String(row.name))
                const defaultBase = `${customerName}_${templateName}_${dtStr}`
                const baseName = filename || defaultBase
                const fnameLocal = baseName
                const outPathLocal = path.join(docsDir, fnameLocal + '.docx')
                try { jobLog(job.id, `outfile:${path.basename(outPathLocal)}`) } catch {}
                fs.writeFileSync(outPathLocal, merged)
                markJobDone(job.id, { path: outPathLocal, name: path.basename(outPathLocal) }, { usedWorkspace })
                return res.status(201).json({ ok: true, file: { path: outPathLocal, name: path.basename(outPathLocal) }, ...(usedWorkspace ? { usedWorkspace } : {}), logs: [...logs, 'fullgen:ok'], jobId: job.id })
              }
            } catch (e:any) {
              const em = `Full generator failed: ${e?.message || e}`
              logs.push(`fullgen:error ${(e?.message||e)}`)
              try { const j = (jobId ? getJob(String(jobId)) : undefined); if (j) { jobLog(j.id, `error:${em}`); markJobError(j.id, em) } } catch {}
              return res.status(500).json({ error: em, ...(jobId ? { jobId } : {}) })
            }
          } else {
            return res.status(400).json({ error: 'Template not compiled: generator.full.ts missing' })
          }
        } catch {}

        // No alternate paths; single-method WML merge enforced
        return
      } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
      }
    }
  )
})

export default router

// Lightweight health + signature endpoint for troubleshooting runtime version
router.get("/health", (_req, res) => {
  try { return res.json({ ok: true, signature: 'naming-v2' }) } catch (e:any) { return res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})

// Live log streaming via Server-Sent Events (SSE)
router.get("/stream", async (req, res) => {
  try {
    const customerId = Number(req.query.customerId)
    const slug = String(req.query.template || '')
    const filename = req.query.filename ? String(req.query.filename) : undefined
    // Default to refresh=true so the AI-updated generator is rebuilt each run unless explicitly disabled
    const refresh = String((req.query.refresh ?? 'true')).toLowerCase() === 'true'
    if (!customerId || !slug) {
      res.writeHead(400, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'customerId and template are required' })}\n\n`)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-DocSmith-Signature': 'naming-v2' })
    const send = (obj: any) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`) } catch {} }
    // Identify server build for troubleshooting
    try { send({ type: 'info', signature: 'naming-v2' }) } catch {}
    const log = (message: string) => send({ type: 'log', message })
    // Structured step reporting
    const totalSteps = 8
    let completed = 0
    const stepStart = (name: string) => send({ type: 'step', name, status: 'start', progress: Math.round((completed/totalSteps)*100) })
    const stepOk = (name: string) => { completed = Math.min(totalSteps, completed + 1); send({ type: 'step', name, status: 'ok', progress: Math.round((completed/totalSteps)*100) }) }

    const db = getDB()
    const row = await new Promise<{ id: number; name: string; createdAt: string; workspaceSlug?: string | null } | null>((resolve, reject) => {
      db.get<{ id: number; name: string; createdAt: string; workspaceSlug?: string | null }>(
        "SELECT id, name, createdAt, workspaceSlug FROM customers WHERE id = ?",
        [customerId],
        (err, row) => { if (err) reject(err); else resolve(row || null) }
      )
    })
    if (!row) { send({ type: 'error', error: 'Customer not found' }); return res.end() }
    stepOk('resolveCustomer')

    const tpl = loadTemplate(String(slug), TEMPLATES_ROOT)
    if (!tpl) { send({ type: 'error', error: 'Template not found' }); return res.end() }
    stepOk('loadTemplate')
    const docsDir = ensureDocumentsDir(row.id, row.name, new Date(row.createdAt))
    // Inform client where the document will be stored (dir only)
    try { send({ type: 'info', documentsDir: docsDir }) } catch {}

    try {
      const metaPath = path.join((tpl as any).dir, 'template.json')
      let wsSlug: string | undefined = row.workspaceSlug ? String(row.workspaceSlug) : undefined
      if (!wsSlug && fs.existsSync(metaPath)) {
        try { const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); if (meta?.workspaceSlug) wsSlug = String(meta.workspaceSlug) } catch {}
      }
      const fullGenPath = path.join((tpl as any).dir, 'generator.full.ts')
      if (!fs.existsSync(fullGenPath)) { send({ type: 'error', error: 'Template not compiled: generator.full.ts missing' }); return res.end() }
      const wsForGen = row.workspaceSlug || wsSlug
      if (!wsForGen) { send({ type: 'error', error: 'Customer workspace is required to generate. Attach a workspace to this customer.' }); return res.end() }
      send({ type: 'info', usedWorkspace: wsForGen })
      stepOk('resolveWorkspace')

      // Create job record
      const job = createJob({ customerId: row.id, customerName: row.name, template: slug as string, filename, usedWorkspace: wsForGen })
      send({ type: 'info', jobId: job.id })
      const logAndPush = (m: string) => { log(m); jobLog(job.id, m) }
      const stepStartRec = (n: string) => { stepStart(n); jobStepStart(job.id, n) }
      const stepOkRec = (n: string) => { stepOk(n); jobStepOk(job.id, n) }

      let tsCode = fs.readFileSync(fullGenPath, 'utf-8')
      stepOkRec('readGenerator')
      // Cache AI-modified generator per template/workspace
      const cacheDir = path.join((tpl as any).dir, '.cache')
      try { fs.mkdirSync(cacheDir, { recursive: true }) } catch {}
      const cacheFile = path.join(cacheDir, `generator.full.${wsForGen}.ts`)
      const genStat = (()=>{ try { return fs.statSync(fullGenPath) } catch { return null } })()
      const cacheStat = (()=>{ try { return fs.statSync(cacheFile) } catch { return null } })()
      const CACHE_TTL_MS = 15 * 60 * 1000
      const cacheFresh = !!(cacheStat && (Date.now() - cacheStat.mtimeMs) < CACHE_TTL_MS)
      const cacheUpToDate = !!(cacheStat && genStat && cacheStat.mtimeMs >= genStat.mtimeMs)
      if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
      if (!refresh && cacheFresh && cacheUpToDate) {
        try { tsCode = fs.readFileSync(cacheFile, 'utf-8'); logAndPush('ai-cache:hit') } catch {}
        stepOkRec('aiUpdate')
      } else {
        logAndPush('ai-modified:start')
        stepStartRec('aiUpdate')
        try {
          const aiPrompt = `You are a senior TypeScript engineer. Update the following document generator function to incorporate customer-specific data from THIS WORKSPACE. Keep the EXACT export signature. Compose the final output as raw WordprocessingML (WML) via return { wml }. Do not import external modules or do file I/O. Maintain formatting with runs (color/size/bold/italic/underline/strike/font) and paragraph props (align/spacing/indents).\n\nSTRICT CONSTRAINTS:\n- PRESERVE ALL EXISTING WML STRUCTURE AND STYLING from the CURRENT GENERATOR CODE: do not alter fonts, colors, sizes, spacing, numbering, table properties, headers/footers, or section settings.\n- ONLY substitute text content (and list/table cell values) with workspace-derived strings.\n- DO NOT add, remove, or reorder sections/paragraphs/tables/runs unless absolutely necessary. If no data is found, keep the section and leave values empty rather than inventing content.\n- No boilerplate or extra headings; do not add content beyond what the template structure implies.\n- IMPORTANT: At runtime, toolkit.json/query/text are DISABLED. Do not rely on them. Encode all workspace-informed content directly in the returned WML or via the provided context parameter.\n- Use minimal LLM calls (within this single update).\n\nOnly output TypeScript code with the updated generate implementation.\n\nCURRENT GENERATOR CODE:\n\n\`\`\`ts\n${tsCode}\n\`\`\``
          const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(wsForGen)}/chat`, 'POST', { message: aiPrompt, mode: 'query' })
          const t = String(r?.textResponse || r?.message || r || '')
          const m = t.match(/```[a-z]*\s*([\s\S]*?)```/i)
          const codeOut = (m && m[1]) ? m[1] : t
          if (!codeOut || !/export\s+async\s+function\s+generate\s*\(/.test(codeOut)) throw new Error('AI did not return a valid generate function')
          tsCode = codeOut.trim()
          fs.writeFileSync(cacheFile, tsCode, 'utf-8')
          logAndPush('ai-modified:ok')
          stepOkRec('aiUpdate')
        } catch (e:any) {
          const errMsg = `AI could not update generator: ${e?.message || e}`
          jobLog(job.id, `error:${errMsg}`)
          markJobError(job.id, errMsg)
          send({ type: 'error', error: errMsg })
          return res.end()
        }
      }

      if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
      logAndPush('transpile:start')
      stepStartRec('transpile')
      const jsOut = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } })
      logAndPush('transpile:ok')
      stepOkRec('transpile')
      const sandbox: any = { module: { exports: {} }, console }
      // Ensure `exports` references `module.exports` like Node's wrapper
      ;(sandbox as any).exports = (sandbox as any).module.exports
      vm.createContext(sandbox)
      const wrapped = `(function (module, exports) { ${jsOut.outputText}\n;return module.exports; })`
      const fn = vm.runInContext(wrapped, sandbox)
      const mod = fn(sandbox.module, (sandbox as any).module.exports)
      let generateFull = mod?.generate
      if (typeof mod === 'function') {
        generateFull = mod as any
      }
      if (typeof generateFull !== 'function' && typeof (mod as any)?.default === 'function') {
        generateFull = (mod as any).default
      }
      if (typeof generateFull !== 'function' && (mod as any)?.default && typeof (mod as any).default.generate === 'function') {
        generateFull = (mod as any).default.generate
      }
      if (typeof generateFull !== 'function') {
        try { jobLog(job.id, `exportsKeys:${Object.keys(mod||{}).join(',')}`) } catch {}
        // Invalidate cached AI-updated code so next run will regenerate
        try { const cacheDir = path.join((tpl as any).dir, '.cache'); const cacheFile = path.join(cacheDir, `generator.full.${wsForGen}.ts`); if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile) } catch {}
        jobLog(job.id, 'error:generate-missing'); markJobError(job.id, 'generate function missing'); send({ type: 'error', error: 'generate function missing' }); return res.end()
      }

      // Minimal builder + toolkit
      const docxLib = require('docx')
      const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, UnderlineType } = docxLib
      const doc = new Document({ sections: [{ properties: {}, children: [] }] })
      const children: any[] = (doc as any).Sections?.[0]?.properties?.children || (doc as any).sections?.[0]?.children || []
      const builderUsed = { used: false }
      const builder = {
        addHeading: (text: string, level: 1|2|3|4|5|6 = 1) => { builderUsed.used = true; children.push(new Paragraph({ heading: {1:HeadingLevel.HEADING_1,2:HeadingLevel.HEADING_2,3:HeadingLevel.HEADING_3,4:HeadingLevel.HEADING_4,5:HeadingLevel.HEADING_5,6:HeadingLevel.HEADING_6}[level] || HeadingLevel.HEADING_1, children: [ new TextRun(String(text||'')) ] })) },
        addParagraph: (text: string) => { builderUsed.used = true; children.push(new Paragraph({ children: [ new TextRun(String(text||'')) ] })) },
        addBulletList: (items: string[]) => { builderUsed.used = true; for (const it of (items||[])) children.push(new Paragraph({ text: String(it||''), bullet: { level: 0 } })) },
        addNumberedList: (items: string[]) => { builderUsed.used = true; for (const it of (items||[])) children.push(new Paragraph({ text: String(it||''), numbering: { reference: 'num-default', level: 0 } })) },
        addTable: (rows: Array<string[]>) => { builderUsed.used = true; const tRows = (rows||[]).map(r => new TableRow({ children: (r||[]).map(c => new TableCell({ children: [ new Paragraph(String(c||'')) ] })) })); children.push(new Table({ rows: tRows, width: { size: 100, type: WidthType.PERCENTAGE } })) },
        pageBreak: () => { builderUsed.used = true; children.push(new Paragraph({ children: [], pageBreakBefore: true })) },
        save: async (): Promise<Uint8Array> => { return await Packer.toUint8Array(new Document({ sections: [{ properties: {}, children }] })) }
      }
      const toolkit = {
        json: async (_prompt: string) => { throw new Error('Runtime AI disabled: toolkit.json unavailable') },
        query: async (_prompt: string) => { throw new Error('Runtime AI disabled: toolkit.query unavailable') },
        text: async (_prompt: string) => { throw new Error('Runtime AI disabled: toolkit.text unavailable') },
        getSkeleton: async (kind?: 'html'|'text') => { try { const buffer = fs.readFileSync((tpl as any).templatePath); if (kind === 'html' || !kind) { const result = await (mammoth as any).convertToHtml({ buffer }, { styleMap: ["p[style-name='Title'] => h1:fresh","p[style-name='Subtitle'] => h2:fresh","p[style-name='Heading 1'] => h1:fresh","p[style-name='Heading 2'] => h2:fresh","p[style-name='Heading 3'] => h3:fresh"] }); return String(result?.value || '') } else { const result = await (mammoth as any).extractRawText({ buffer }); return String(result?.value || '') } } catch { return '' } },
        markdownToHtml: (md: string) => (marked as any).parse(String(md || '')) as string,
        htmlToDocx: async (html: string) => { return await (htmlToDocx as any)(String(html || '')) }
      }

      if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
      logAndPush('generate:start')
      stepStartRec('execute')
      const context: any = { customer: { id: row.id, name: row.name }, now: new Date().toISOString() }
      const result = await generateFull(toolkit, builder, context)
      logAndPush('generate:ok')
      stepOkRec('execute')
      if ((tpl as any).kind !== 'docx') { jobLog(job.id, 'error:template-kind'); markJobError(job.id, 'Template must be DOCX for WML merge'); send({ type: 'error', error: 'Template must be DOCX for WML merge' }); return res.end() }
      if (!result || (!('wml' in (result as any)) && !('bodyXml' in (result as any)))) { jobLog(job.id, 'error:no-wml'); markJobError(job.id, 'Full generator did not return WML/bodyXml'); send({ type: 'error', error: 'Full generator did not return WML/bodyXml' }); return res.end() }
      const inner = String((result as any).wml || (result as any).bodyXml || '')
      if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
      logAndPush('merge:start')
      stepStartRec('mergeWrite')
      const merged = (await import('../services/docxCompose')).mergeWmlIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), inner)
      logAndPush('merge:ok')
      // Default filename: {Customer}_{TemplateName}_{YYYYMMDD_HHmmss}
      const dt2 = new Date()
      const dtStr2 = `${dt2.getFullYear()}${String(dt2.getMonth()+1).padStart(2,'0')}${String(dt2.getDate()).padStart(2,'0')}_${String(dt2.getHours()).padStart(2,'0')}${String(dt2.getMinutes()).padStart(2,'0')}${String(dt2.getSeconds()).padStart(2,'0')}`
      const templateName2 = safeFileName(String(displayNameFromSlug(String(slug))))
      const customerName2 = safeFileName(String(row.name))
      const defaultBase2 = `${customerName2}_${templateName2}_${dtStr2}`
      const baseName2 = filename || defaultBase2
      const fnameLocal = baseName2
      // Emit SSE info with resolved names
      try { send({ type: 'info', templateName: templateName2, customerName: customerName2, outfile: fnameLocal + '.docx' }) } catch {}
      const outPathLocal = path.join(docsDir, fnameLocal + '.docx')
      try { jobLog(job.id, `outfile:${path.basename(outPathLocal)}`) } catch {}
      fs.writeFileSync(outPathLocal, merged)
      stepOkRec('mergeWrite')
      markJobDone(job.id, { path: outPathLocal, name: path.basename(outPathLocal) }, { usedWorkspace: wsForGen })
      send({ type: 'done', file: { path: outPathLocal, name: path.basename(outPathLocal) }, usedWorkspace: wsForGen, jobId: job.id })
      return res.end()
    } catch (e:any) {
      const msg = String(e?.message || e)
      try { jobLog((getJob as any)?.id, `error:${msg}`) } catch {}
      send({ type: 'error', error: msg }); return res.end()
    }
  } catch (e:any) {
    try { res.writeHead(500, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ type: 'error', error: String(e?.message || e) })}\n\n`) } catch {}
    return res.end()
  }
})

// List recent generation jobs
router.get("/jobs", (_req, res) => {
  try { return res.json({ jobs: listJobs(50) }) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

// Get one job with logs
router.get("/jobs/:id", (req, res) => {
  try { const j = getJob(String(req.params.id)); if (!j) return res.status(404).json({ error: 'Not found' }); return res.json(j) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

// Cancel a running job (best-effort)
router.post("/jobs/:id/cancel", (req, res) => {
  try { cancelJob(String(req.params.id)); return res.json({ ok: true }) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

// Download or open the file associated with a job
router.get("/jobs/:id/file", (req, res) => {
  try {
    const j = getJob(String(req.params.id))
    if (!j || !j.file?.path) return res.status(404).json({ error: 'Not found' })
    const root = libraryRoot()
    const resolved = path.resolve(String(j.file.path))
    // Ensure the file is under the library root for safety
    if (!resolved.startsWith(path.resolve(root))) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const download = String(req.query.download || '').toLowerCase() === 'true'
    if (download) return res.download(resolved, path.basename(resolved))
    return res.sendFile(resolved)
  } catch (e:any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
})

// Delete one job record (does not delete any files)
router.delete("/jobs/:id", (req, res) => {
  try { deleteJob(String(req.params.id)); return res.json({ ok: true }) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

// Clear all job records (does not delete files)
router.delete("/jobs", (_req, res) => {
  try { clearJobs(); return res.json({ ok: true }) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

// Reveal the generated file in the OS file explorer (server host)
router.get("/jobs/:id/reveal", (req, res) => {
  try {
    const j = getJob(String(req.params.id))
    if (!j || !j.file?.path) return res.status(404).json({ error: 'Not found' })
    const root = libraryRoot()
    const resolved = path.resolve(String(j.file.path))
    if (!resolved.startsWith(path.resolve(root))) return res.status(403).json({ error: 'Forbidden' })

    const platform = process.platform
    if (platform === 'win32') {
      child_process.spawn('explorer.exe', ['/select,', resolved], { detached: true, stdio: 'ignore' }).unref()
    } else if (platform === 'darwin') {
      child_process.spawn('open', ['-R', resolved], { detached: true, stdio: 'ignore' }).unref()
    } else {
      child_process.spawn('xdg-open', [path.dirname(resolved)], { detached: true, stdio: 'ignore' }).unref()
    }
    return res.json({ ok: true })
  } catch (e:any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
})
