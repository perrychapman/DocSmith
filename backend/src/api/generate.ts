import { Router } from "express"
import fs from "fs"
import path from "path"
import child_process from "child_process"
import { getDB } from "../services/storage"
import { loadTemplate } from "../services/templateEngine"
import { ensureDocumentsDir } from "../services/customerLibrary"
import { libraryRoot, safeFileName, displayNameFromSlug } from "../services/fs"
import { anythingllmRequest } from "../services/anythingllm"
import { createJob, createJobWithId, appendLog as jobLog, markJobDone, markJobError, listJobs, getJob, stepStart as jobStepStart, stepOk as jobStepOk, cancelJob, isCancelled, initJobs, deleteJob, clearJobs } from "../services/genJobs"
import { analyzeDocumentIntelligently } from "../services/documentIntelligence"
import { buildMetadataEnhancedContext } from "../services/metadataMatching"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ts = require('typescript')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vm = require('vm')
const mammoth = require('mammoth')
const { marked } = require('marked')
const htmlToDocx = require('html-to-docx')

function getTemplateDisplayName(tplDir: string, slug: string): string {
  try {
    const metaPath = path.join(tplDir, "template.json")
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
      const n = String(meta?.name || "").trim()
      if (n) return n
    }
  } catch {}
  return displayNameFromSlug(String(slug))
}


initJobs()
const router = Router()

const TEMPLATES_ROOT = path.join(libraryRoot(), "templates")

type Body = { customerId?: number; template?: string; filename?: string; refresh?: boolean; jobId?: string; instructions?: string; pinnedDocuments?: string[] }

router.post("/", async (req, res) => {
  const { customerId, template: slug, filename, refresh, jobId, instructions, pinnedDocuments } = (req.body || {}) as Body
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
        
        const context: any = { customer: { id: row.id, name: row.name }, now: new Date().toISOString() }
        if (instructions && String(instructions).trim().length) {
          context.userInstructions = String(instructions)
        }

        let usedWorkspace: string | undefined
        const logs: string[] = []
        try {
          let wsSlug: string | undefined = row.workspaceSlug ? String(row.workspaceSlug) : undefined
          const fullGenPath = path.join(tpl.dir, 'generator.full.ts')
          if (fs.existsSync(fullGenPath)) {
            let wsForGen: string | undefined

            
            try {
              wsForGen = row.workspaceSlug || wsSlug
              if (!wsForGen) {
                return res.status(400).json({ error: 'Customer workspace is required to generate. Please attach a workspace to this customer.' })
              }
              usedWorkspace = wsForGen
              
              const job = jobId && String(jobId).trim().length > 0
                ? createJobWithId({ id: String(jobId), customerId: row.id, customerName: row.name, template: slug as string, filename, usedWorkspace: wsForGen, instructions, pinnedDocuments })
                : createJob({ customerId: row.id, customerName: row.name, template: slug as string, filename, usedWorkspace: wsForGen, instructions, pinnedDocuments })
              const logAndPush = (m: string) => { try { jobLog(job.id, m) } catch {} }
              const stepStartRec = (n: string) => { try { jobStepStart(job.id, n) } catch {} }
              const stepOkRec = (n: string) => { try { jobStepOk(job.id, n) } catch {} }
              
              let tsCode = fs.readFileSync(fullGenPath, 'utf-8')
              stepOkRec('readGenerator')

              // Check for cached AI-enhanced generator (per-workspace, 15min TTL)
              const cacheDir = path.join((tpl as any).dir, '.cache')
              try { fs.mkdirSync(cacheDir, { recursive: true }) } catch {}
              const cacheFile = path.join(cacheDir, `generator.full.${wsForGen}.ts`)
              const genStat = (()=>{ try { return fs.statSync(fullGenPath) } catch { return null } })()
              const cacheStat = (()=>{ try { return fs.statSync(cacheFile) } catch { return null } })()
              const CACHE_TTL_MS = 15 * 60 * 1000
              const cacheFresh = !!(cacheStat && (Date.now() - cacheStat.mtimeMs) < CACHE_TTL_MS)
              const cacheUpToDate = !!(cacheStat && genStat && cacheStat.mtimeMs >= genStat.mtimeMs)
              const forceRefresh = refresh !== false
              if (!forceRefresh && cacheFresh && cacheUpToDate) {
                try {
                  tsCode = fs.readFileSync(cacheFile, 'utf-8')
                  logs.push('ai-cache:hit')
                  logAndPush('ai-cache:hit')
                } catch {}
              }

              // AI enhancement: modify generator to incorporate workspace-specific data
              try {
                if (forceRefresh || !(logs.includes('ai-cache:hit'))) {
                stepStartRec('analyzeTemplate')
                logAndPush('[ANALYSIS] Analyzing template structure and workspace data...')
                let documentAnalysis = ''
                let metadataContext = ''
                try {
                  logAndPush('[METADATA] Analyzing template requirements and available documents')
                  const enhancedCtx = await buildMetadataEnhancedContext(
                    String(slug),
                    row.id,
                    wsForGen
                  )
                  
                  if (enhancedCtx.templateMetadata) {
                    const meta = enhancedCtx.templateMetadata
                    if (meta.templateType) {
                      logAndPush(`[METADATA] Template type: ${meta.templateType}`)
                    }
                    if (meta.purpose) {
                      logAndPush(`[METADATA] Template purpose: ${meta.purpose.substring(0, 100)}${meta.purpose.length > 100 ? '...' : ''}`)
                    }
                    if (meta.requiredDataTypes?.length) {
                      logAndPush(`[METADATA] Required data types: ${meta.requiredDataTypes.join(', ')}`)
                    }
                    if (meta.expectedEntities?.length) {
                      logAndPush(`[METADATA] Expected entities: ${meta.expectedEntities.join(', ')}`)
                    }
                  }
                  
                  if (enhancedCtx.relevantDocuments.length > 0) {
                    logAndPush(`[METADATA] Found ${enhancedCtx.relevantDocuments.length} relevant workspace document(s)`)
                    const top5 = enhancedCtx.relevantDocuments.slice(0, 5)
                    top5.forEach((doc, idx) => {
                      logAndPush(`[METADATA]   ${idx + 1}. ${doc.filename} (relevance: ${doc.relevanceScore}/10) - ${doc.reasoning.substring(0, 80)}${doc.reasoning.length > 80 ? '...' : ''}`)
                    })
                  } else {
                    logAndPush('[METADATA] No relevant documents found - using general workspace query')
                  }
                  
                  logAndPush(`[METADATA] Context enhancement complete (${enhancedCtx.promptEnhancement.length + enhancedCtx.documentSummaries.length} chars)`)
                  metadataContext = enhancedCtx.promptEnhancement + enhancedCtx.documentSummaries
                  
                  if ((tpl as any).templatePath && fs.existsSync((tpl as any).templatePath)) {
                    logAndPush('[ANALYSIS] Analyzing template document structure...')
                    documentAnalysis = await analyzeDocumentIntelligently(
                      (tpl as any).templatePath,
                      String(slug),
                      wsForGen,
                      'generation'
                    )
                    if (documentAnalysis) {
                      logAndPush('[ANALYSIS] Template structure analysis complete')
                    }
                  }
                } catch (analysisErr) {
                  logAndPush(`[ANALYSIS] Warning: ${(analysisErr as Error).message}`)
                }
                stepOkRec('analyzeTemplate')
                
                const userAddendum = instructions && String(instructions).trim().length
                  ? `\n\nUSER ADDITIONAL INSTRUCTIONS (prioritize when writing queries):\n${String(instructions).trim()}\n`
                  : ''
                  
                const modeGuidance = `\n\nHYBRID DYNAMIC MODE (ALWAYS ENABLED):\n- At runtime, toolkit.json/query/text ARE AVAILABLE for data fetching\n- PRESERVE the template's structure and formatting (static)\n- FETCH variable data dynamically using toolkit methods\n- Example: const data = await toolkit.json('Check workspace index, then return all inventory items with columns: name, quantity, price')\n- The generator will be called fresh for each document generation\n- Use the metadata context below to write intelligent queries that target specific documents\n- Reference pinned or high-relevance documents explicitly in queries\n- ALWAYS reference the workspace document index first to discover available files\n\nIMPORTANT SEPARATION:\n1. STATIC PART (from template): Headers, titles, formatting, styles, table structure, fonts, colors\n2. DYNAMIC PART (from workspace): Actual data values, list items, table rows, variable content\n`
                
                const aiPrompt = ((tpl as any).kind === 'excel')
                  ? `You are a senior TypeScript engineer and spreadsheet specialist. Update the following DocSmith Excel generator function to use a HYBRID approach: preserve the template's structure/formatting (static) but fetch variable data dynamically. Keep the EXACT export signature. Compose the final output by returning { sheets } (sheet ops). Do not import external modules or do file I/O.${modeGuidance}\nSTRICT CONSTRAINTS:
- PRESERVE EXISTING SHEET STRUCTURE AND FORMATTING from the CURRENT GENERATOR CODE: do not alter existing fonts, colors, fills, borders, number formats, alignment, merged ranges, column widths, or sheet order unless absolutely necessary.
- SEPARATE CONCERNS:\n  * STATIC: Sheet names, header rows, column headers, formatting rules, merged cells, widths\n  * DYNAMIC: Data rows fetched via toolkit.json() - query workspace for actual values\n- DYNAMIC EXPANSION: Use toolkit.json() to fetch ALL data rows at runtime. If workspace has 500 items, fetch all 500.\n  Example: const data = await toolkit.json('From inventory.xlsx, return all rows as JSON array with columns: Item, Quantity, Price')\n- You MAY append or insert new rows to accommodate variable-length data. Use insertRows with copyStyleFromRow when appropriate to preserve formatting.\n- If the template has a merged and centered header row, preserve it exactly - write data below it.\n- For variable data rows, use 'ranges' array for efficiency instead of individual cells.\n- EXPAND DYNAMICALLY: The template structure is preserved, but data is fetched fresh each generation.${documentAnalysis}${metadataContext}${userAddendum}

Return type reminder:
Promise<{ sheets: Array<{ name: string; insertRows?: Array<{ at: number; count: number; copyStyleFromRow?: number }>; cells?: Array<{ ref: string; v: string|number|boolean; numFmt?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; bg?: string; align?: 'left'|'center'|'right'; wrap?: boolean }>; ranges?: Array<{ start: string; values: any[][]; numFmt?: string }> }> }>;

Only output TypeScript code with the updated generate implementation.

CURRENT GENERATOR CODE:

\`\`\`ts
${tsCode}
\`\`\``
                  : `You are a senior TypeScript engineer. Update the following DocSmith generator function to use a HYBRID approach: preserve the template's WML structure/styling (static) but fetch variable data dynamically. Keep the EXACT export signature. Compose the final output as raw WordprocessingML (WML) via return { wml }. Do not import external modules or do file I/O. Maintain formatting with runs (color/size/bold/italic/underline/strike/font) and paragraph props (align/spacing/indents).${modeGuidance}
STRICT CONSTRAINTS:
- PRESERVE ALL EXISTING WML STRUCTURE AND STYLING from the CURRENT GENERATOR CODE: do not alter fonts, colors, sizes, spacing, numbering, table properties, headers/footers, or section settings.
- SEPARATE CONCERNS:\n  * STATIC: Document structure, headers, titles, formatting tags, paragraph props, table structure, styles\n  * DYNAMIC: Text content values fetched via toolkit.json() - query workspace for actual data\n- DYNAMIC EXPANSION: Use toolkit.json() to fetch ALL data at runtime.\n  Example: const items = await toolkit.json('From inventory.xlsx, return all items with columns: name, quantity, price')\n- For TABLES: Preserve WML table structure (<w:tbl>), replicate <w:tr> for each data row\n- For LISTS: Preserve numbering format, replicate <w:p> with list props for each item\n- For SECTIONS: Keep section structure from template, populate with workspace data\n- ONLY substitute <w:t> text content with workspace-derived values\n- DO NOT alter WML formatting tags unless expanding data requires it\n- EXPAND DYNAMICALLY: The template WML is the STRUCTURE, workspace data fills the VALUES.${documentAnalysis}${metadataContext}${userAddendum}

Only output TypeScript code with the updated generate implementation.

CURRENT GENERATOR CODE:

\`\`\`ts
${tsCode}
\`\`\``
                stepStartRec('aiUpdate')
                logAndPush(`[AI] Sending ${((tpl as any).kind === 'excel') ? 'Excel' : 'DOCX'} generation request to workspace: ${wsForGen}`)
                logAndPush(`[AI] Prompt size: ${aiPrompt.length} chars (analysis: ${documentAnalysis.length}, metadata: ${metadataContext.length})`)
                const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(wsForGen)}/chat`, 'POST', { message: aiPrompt, mode: 'query' })
                const t = String(r?.textResponse || r?.message || r || '')
                logAndPush(`[AI] Response received (${t.length} chars)`)
                const m = t.match(/```[a-z]*\s*([\s\S]*?)```/i)
                const codeOut = (m && m[1]) ? m[1] : t
                if (m && m[1]) {
                  logAndPush('[AI] Extracted code from markdown fence blocks')
                }
                if (!codeOut || !/export\s+async\s+function\s+generate\s*\(/.test(codeOut)) throw new Error('AI did not return a valid generate function')
                tsCode = codeOut.trim()
                logAndPush(`[AI] Enhanced generator ready (${tsCode.length} chars)`)
                logs.push('ai-modified:ok')
                logAndPush('[GENERATION] AI enhancement complete')
                stepOkRec('aiUpdate')
                try { fs.writeFileSync(cacheFile, tsCode, 'utf-8') } catch {}
                } else {
                  logs.push('ai-cache:used')
                  logAndPush('[GENERATION] Using cached AI-enhanced generator')
                }
              } catch (e:any) {
                const errMsg = `AI could not update generator: ${e?.message || e}`
                logAndPush(`error:${errMsg}`)
                markJobError(job.id, errMsg)
                return res.status(502).json({ error: errMsg, jobId: job.id })
              }
              if (isCancelled(job.id)) { logAndPush('cancelled'); return res.status(499).json({ error: 'cancelled', jobId: job.id }) }
              
              stepStartRec('transpile')
              logAndPush('[TRANSPILE] Compiling TypeScript generator to JavaScript...')
              const jsOut = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } })
              logAndPush(`[TRANSPILE] Transpilation complete (${jsOut.outputText.length} chars JavaScript)`)
              stepOkRec('transpile')
              
              stepStartRec('execute')
              logAndPush('[EXECUTE] Loading generator module into sandbox...')
              const sandbox: any = { module: { exports: {} }, console }
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
                logAndPush('[EXECUTE] Error: generate function not found in module')
                markJobError(job.id, 'generate function missing')
                return res.status(502).json({ error: 'generate function missing', jobId: job.id })
              }
              logAndPush('[EXECUTE] Generator module loaded successfully')
              
              if (typeof generateFull === 'function') {
                if (isCancelled(job.id)) { logAndPush('cancelled'); return res.status(499).json({ error: 'cancelled', jobId: job.id }) }
                
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
                  json: async (prompt: string) => {
                    logAndPush(`[RUNTIME-QUERY] Executing toolkit.json query...`)
                    const response = await anythingllmRequest<any>(
                      `/workspace/${encodeURIComponent(wsForGen!)}/chat`,
                      'POST',
                      { message: String(prompt), mode: 'query' }
                    )
                    const text = String(response?.textResponse || response?.message || '')
                    try {
                      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
                      const jsonText = jsonMatch ? jsonMatch[1] : text
                      const parsed = JSON.parse(jsonText)
                      logAndPush(`[RUNTIME-QUERY] Successfully parsed JSON response`)
                      return parsed
                    } catch {
                      logAndPush('[RUNTIME-QUERY] Could not parse JSON, returning raw text')
                      return text
                    }
                  },
                  query: async (prompt: string) => {
                    logAndPush(`[RUNTIME-QUERY] Executing toolkit.query...`)
                    const response = await anythingllmRequest<any>(
                      `/workspace/${encodeURIComponent(wsForGen!)}/chat`,
                      'POST',
                      { message: String(prompt), mode: 'query' }
                    )
                    const result = response?.textResponse || response?.message || ''
                    logAndPush(`[RUNTIME-QUERY] Response received (${String(result).length} chars)`)
                    return result
                  },
                  text: async (prompt: string) => {
                    logAndPush(`[RUNTIME-QUERY] Executing toolkit.text query...`)
                    const response = await anythingllmRequest<any>(
                      `/workspace/${encodeURIComponent(wsForGen!)}/chat`,
                      'POST',
                      { message: String(prompt), mode: 'query' }
                    )
                    const result = String(response?.textResponse || response?.message || '')
                    logAndPush(`[RUNTIME-QUERY] Response received (${result.length} chars)`)
                    return result
                  },
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
                
                logAndPush('[EXECUTE] Running generator function with workspace toolkit...')
                const result = await generateFull(toolkit, builder, context)
                logAndPush('[EXECUTE] Generator execution complete')
                stepOkRec('execute')
                
                if ((tpl as any).kind === 'docx') {
                  if (!result || (!('wml' in (result as any)) && !('bodyXml' in (result as any)))) {
                    logAndPush('[EXECUTE] Error: Generator did not return WML/bodyXml')
                    markJobError(job.id, 'Full generator did not return WML/bodyXml')
                    return res.status(502).json({ error: 'Full generator did not return WML/bodyXml', jobId: job.id })
                  }
                  const inner = String((result as any).wml || (result as any).bodyXml || '')
                  logAndPush(`[MERGE] Merging generated content (${inner.length} chars) into template...`)
                  if (isCancelled(job.id)) { logAndPush('cancelled'); return res.status(499).json({ error: 'cancelled', jobId: job.id }) }
                  
                  stepStartRec('merge')
                  const merged = (await import('../services/docxCompose')).mergeWmlIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), inner)
                  logAndPush(`[MERGE] Document merge complete (${merged.length} bytes)`)
                  stepOkRec('merge')
                  
                  const dt = new Date()
                  const dtStr = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}_${String(dt.getHours()).padStart(2,'0')}${String(dt.getMinutes()).padStart(2,'0')}${String(dt.getSeconds()).padStart(2,'0')}`
                  const templateName = safeFileName(getTemplateDisplayName((tpl as any).dir, String(slug)))
                  const customerName = safeFileName(String(row.name))
                  const defaultBase = `${customerName}_${templateName}_${dtStr}`
                  const baseName = filename || defaultBase
                  const fnameLocal = baseName
                  const outPathLocal = path.join(docsDir, fnameLocal + '.docx')
                  logAndPush(`[OUTPUT] Writing document: ${path.basename(outPathLocal)}`)
                  try { jobLog(job.id, `outfile:${path.basename(outPathLocal)}`) } catch {}
                  fs.writeFileSync(outPathLocal, merged)
                  logAndPush('[OUTPUT] Document generation complete!')
                  
                  markJobDone(job.id, { path: outPathLocal, name: path.basename(outPathLocal) }, { usedWorkspace })
                  return res.status(201).json({ ok: true, file: { path: outPathLocal, name: path.basename(outPathLocal) }, ...(usedWorkspace ? { usedWorkspace } : {}), logs: [...logs, 'fullgen:ok'], jobId: job.id })
                } else if ((tpl as any).kind === 'excel') {
                  if (!result || !('sheets' in (result as any))) {
                    logAndPush('[EXECUTE] Error: Generator did not return sheets for Excel')
                    markJobError(job.id, 'Full generator did not return sheets for Excel')
                    return res.status(502).json({ error: 'Full generator did not return sheets for Excel', jobId: job.id })
                  }
                  const sheetCount = Array.isArray((result as any).sheets) ? (result as any).sheets.length : 0
                  logAndPush(`[MERGE] Merging ${sheetCount} sheet(s) into Excel template...`)
                  if (isCancelled(job.id)) { logAndPush('cancelled'); return res.status(499).json({ error: 'cancelled', jobId: job.id }) }
                  
                  stepStartRec('merge')
                  const mergedBuf = await (await import('../services/excelComposeSheetJS')).mergeOpsIntoExcelTemplate(fs.readFileSync((tpl as any).templatePath), result)
                  logAndPush(`[MERGE] Excel merge complete (${mergedBuf.length} bytes)`)
                  stepOkRec('merge')
                  
                  const dt = new Date()
                  const dtStr = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}_${String(dt.getHours()).padStart(2,'0')}${String(dt.getMinutes()).padStart(2,'0')}${String(dt.getSeconds()).padStart(2,'0')}`
                  const templateName = safeFileName(getTemplateDisplayName((tpl as any).dir, String(slug)))
                  const customerName = safeFileName(String(row.name))
                  const defaultBase = `${customerName}_${templateName}_${dtStr}`
                  const baseName = filename || defaultBase
                  const fnameLocal = baseName
                  const outPathLocal = path.join(docsDir, fnameLocal + '.xlsx')
                  logAndPush(`[OUTPUT] Writing spreadsheet: ${path.basename(outPathLocal)}`)
                  try { jobLog(job.id, `outfile:${path.basename(outPathLocal)}`) } catch {}
                  fs.writeFileSync(outPathLocal, mergedBuf)
                  logAndPush('[OUTPUT] Spreadsheet generation complete!')
                  
                  markJobDone(job.id, { path: outPathLocal, name: path.basename(outPathLocal) }, { usedWorkspace })
                  return res.status(201).json({ ok: true, file: { path: outPathLocal, name: path.basename(outPathLocal) }, ...(usedWorkspace ? { usedWorkspace } : {}), logs: [...logs, 'fullgen:ok'], jobId: job.id })
                } else {
                  markJobError(job.id, 'Unsupported template kind for generation')
                  return res.status(400).json({ error: 'Unsupported template kind for generation', jobId: job.id })
                }
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
        return
      } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
      }
    }
  )
})

export default router

router.get("/health", (_req, res) => {
  try { return res.json({ ok: true, signature: 'naming-v2' }) } catch (e:any) { return res.status(500).json({ ok: false, error: String(e?.message || e) }) }
})

// Server-Sent Events (SSE) endpoint for live generation progress
router.get("/stream", async (req, res) => {
  try {
    const customerId = Number(req.query.customerId)
    const slug = String(req.query.template || '')
    const filename = req.query.filename ? String(req.query.filename) : undefined
    const instructions = req.query.instructions ? String(req.query.instructions) : undefined
    const pinnedDocuments = req.query.pinnedDocuments ? JSON.parse(String(req.query.pinnedDocuments)) : undefined
    const refresh = String((req.query.refresh ?? 'true')).toLowerCase() === 'true'
    if (!customerId || !slug) {
      res.writeHead(400, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'customerId and template are required' })}\n\n`)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-DocSmith-Signature': 'naming-v2' })
    const send = (obj: any) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`) } catch {} }
    try { send({ type: 'info', signature: 'naming-v2' }) } catch {}
    const log = (message: string) => send({ type: 'log', message })
    
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

      // Create job record with pinned documents
      const job = createJob({ customerId: row.id, customerName: row.name, template: slug as string, filename, usedWorkspace: wsForGen, instructions, pinnedDocuments })
      send({ type: 'info', jobId: job.id })
      const logAndPush = (m: string) => { log(m); jobLog(job.id, m) }
      const stepStartRec = (n: string) => { stepStart(n); jobStepStart(job.id, n) }
      const stepOkRec = (n: string) => { stepOk(n); jobStepOk(job.id, n) }

      let tsCode = fs.readFileSync(fullGenPath, 'utf-8')
      stepOkRec('readGenerator')
      
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
          logAndPush('Analyzing template structure and workspace data...')
          let documentAnalysis = ''
          try {
            if ((tpl as any).templatePath && fs.existsSync((tpl as any).templatePath)) {
              documentAnalysis = await analyzeDocumentIntelligently(
                (tpl as any).templatePath,
                String(slug),
                wsForGen,
                'generation'
              )
            }
          } catch (analysisErr) {
            logAndPush(`Analysis warning: ${(analysisErr as Error).message}`)
            // Continue without analysis if it fails
          }
          
          const userAddendum = instructions && String(instructions).trim().length
            ? `\n\nUSER ADDITIONAL INSTRUCTIONS (prioritize when choosing workspace data):\n${String(instructions).trim()}\n`
            : ''
          const modeGuidance = `\n\nHYBRID DYNAMIC MODE (ALWAYS ENABLED):\n- At runtime, toolkit.json/query/text ARE AVAILABLE for data fetching\n- PRESERVE the template's structure and formatting (static)\n- FETCH variable data dynamically using toolkit methods\n- Example: const data = await toolkit.json('Check workspace document index first. Then return all inventory items with columns: name, quantity, price')\n- The generator will be called fresh for each document generation\n- Use the metadata context below to write intelligent queries that target specific documents\n- ALWAYS reference the workspace document index first to discover available files\n\nIMPORTANT SEPARATION:\n1. STATIC PART (from template): Headers, titles, formatting, styles, table structure, fonts, colors\n2. DYNAMIC PART (from workspace): Actual data values, list items, table rows, variable content\n`
          const aiPrompt = ((tpl as any).kind === 'excel')
            ? `You are a senior TypeScript engineer and spreadsheet specialist. Update the following DocSmith Excel generator function to use a HYBRID approach: preserve the template's structure/formatting (static) but fetch variable data dynamically. Keep the EXACT export signature. Compose the final output by returning { sheets } (sheet ops). Do not import external modules or do file I/O.${modeGuidance}\n\nSTRICT CONSTRAINTS:\n- PRESERVE EXISTING SHEET STRUCTURE AND FORMATTING from the CURRENT GENERATOR CODE: do not alter existing fonts, colors, fills, borders, number formats, alignment, merged ranges, column widths, or sheet order unless absolutely necessary.\n- SEPARATE CONCERNS:\n  * STATIC: Sheet names, header rows, column headers, formatting rules, merged cells, widths\n  * DYNAMIC: Data rows fetched via toolkit.json() - query workspace for actual values\n- DYNAMIC EXPANSION: Use toolkit.json() to fetch ALL data rows at runtime. If workspace has 500 items, fetch all 500.\n- You MAY append or insert new rows to accommodate variable-length data. Use insertRows with copyStyleFromRow when appropriate to preserve formatting.\n- If the template has a merged and centered header row, preserve it exactly - write data below it.\n- For variable data rows, use 'ranges' array for efficiency instead of individual cells.\n- EXPAND DYNAMICALLY: The template structure is preserved, but data is fetched fresh each generation.${documentAnalysis}${userAddendum}\n\nReturn type reminder:\nPromise<{ sheets: Array<{ name: string; insertRows?: Array<{ at: number; count: number; copyStyleFromRow?: number }>; cells?: Array<{ ref: string; v: string|number|boolean; numFmt?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; bg?: string; align?: 'left'|'center'|'right'; wrap?: boolean }>; ranges?: Array<{ start: string; values: any[][]; numFmt?: string }> }> }>;\n\nOnly output TypeScript code with the updated generate implementation.\n\nCURRENT GENERATOR CODE:\n\n\`\`\`ts\n${tsCode}\n\`\`\``
            : `You are a senior TypeScript engineer. Update the following DocSmith generator function to use a HYBRID approach: preserve the template's WML structure/styling (static) but fetch variable data dynamically. Keep the EXACT export signature. Compose the final output as raw WordprocessingML (WML) via return { wml }. Do not import external modules or do file I/O. Maintain formatting with runs (color/size/bold/italic/underline/strike/font) and paragraph props (align/spacing/indents).${modeGuidance}\n\nSTRICT CONSTRAINTS:\n- PRESERVE ALL EXISTING WML STRUCTURE AND STYLING from the CURRENT GENERATOR CODE: do not alter fonts, colors, sizes, spacing, numbering, table properties, headers/footers, or section settings.\n- SEPARATE CONCERNS:\n  * STATIC: Document structure, headers, titles, formatting tags, paragraph props, table structure, styles\n  * DYNAMIC: Text content values fetched via toolkit.json() - query workspace for actual data\n- DYNAMIC EXPANSION: Use toolkit.json() to fetch ALL data at runtime.\n  Example: const items = await toolkit.json('Check workspace document index first. Then from inventory.xlsx, return all items with columns: name, quantity, price')\n- For TABLES: Preserve WML table structure (<w:tbl>), replicate <w:tr> for each data row\n- For LISTS: Preserve numbering format, replicate <w:p> with list props for each item\n- For SECTIONS: Keep section structure from template, populate with workspace data\n- ONLY substitute <w:t> text content with workspace-derived values\n- DO NOT alter WML formatting tags unless expanding data requires it\n- EXPAND DYNAMICALLY: The template WML is the STRUCTURE, workspace data fills the VALUES.${documentAnalysis}${userAddendum}\n\nOnly output TypeScript code with the updated generate implementation.\n\nCURRENT GENERATOR CODE:\n\n\`\`\`ts\n${tsCode}\n\`\`\``
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
        json: async (prompt: string) => {
          log('[RUNTIME-QUERY] Executing toolkit.json query...')
          const response = await anythingllmRequest<any>(
            `/workspace/${encodeURIComponent(wsForGen)}/chat`,
            'POST',
            { message: String(prompt), mode: 'query' }
          )
          const text = String(response?.textResponse || response?.message || '')
          try {
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
            const jsonText = jsonMatch ? jsonMatch[1] : text
            const parsed = JSON.parse(jsonText)
            log('[RUNTIME-QUERY] Successfully parsed JSON response')
            return parsed
          } catch {
            log('[RUNTIME-QUERY] Could not parse JSON, returning raw text')
            return text
          }
        },
        query: async (prompt: string) => {
          log('[RUNTIME-QUERY] Executing toolkit.query...')
          const response = await anythingllmRequest<any>(
            `/workspace/${encodeURIComponent(wsForGen)}/chat`,
            'POST',
            { message: String(prompt), mode: 'query' }
          )
          const result = response?.textResponse || response?.message || ''
          log(`[RUNTIME-QUERY] Response received (${String(result).length} chars)`)
          return result
        },
        text: async (prompt: string) => {
          log('[RUNTIME-QUERY] Executing toolkit.text query...')
          const response = await anythingllmRequest<any>(
            `/workspace/${encodeURIComponent(wsForGen)}/chat`,
            'POST',
            { message: String(prompt), mode: 'query' }
          )
          const result = String(response?.textResponse || response?.message || '')
          log(`[RUNTIME-QUERY] Response received (${result.length} chars)`)
          return result
        },
        getSkeleton: async (kind?: 'html'|'text') => { try { const buffer = fs.readFileSync((tpl as any).templatePath); if (kind === 'html' || !kind) { const result = await (mammoth as any).convertToHtml({ buffer }, { styleMap: ["p[style-name='Title'] => h1:fresh","p[style-name='Subtitle'] => h2:fresh","p[style-name='Heading 1'] => h1:fresh","p[style-name='Heading 2'] => h2:fresh","p[style-name='Heading 3'] => h3:fresh"] }); return String(result?.value || '') } else { const result = await (mammoth as any).extractRawText({ buffer }); return String(result?.value || '') } } catch { return '' } },
        markdownToHtml: (md: string) => (marked as any).parse(String(md || '')) as string,
        htmlToDocx: async (html: string) => { return await (htmlToDocx as any)(String(html || '')) }
      }

      if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
      logAndPush('generate:start')
      stepStartRec('execute')
      const context: any = { customer: { id: row.id, name: row.name }, now: new Date().toISOString() }
      if (instructions && String(instructions).trim().length) {
        context.userInstructions = String(instructions)
      }
      const result = await generateFull(toolkit, builder, context)
      logAndPush('generate:ok')
      stepOkRec('execute')
      if ((tpl as any).kind === 'docx') {
        if (!result || (!('wml' in (result as any)) && !('bodyXml' in (result as any)))) { jobLog(job.id, 'error:no-wml'); markJobError(job.id, 'Full generator did not return WML/bodyXml'); send({ type: 'error', error: 'Full generator did not return WML/bodyXml' }); return res.end() }
        const inner = String((result as any).wml || (result as any).bodyXml || '')
        if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
        logAndPush('merge:start')
        stepStartRec('mergeWrite')
        const merged = (await import('../services/docxCompose')).mergeWmlIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), inner)
        logAndPush('merge:ok')
        const dt2 = new Date()
        const dtStr2 = `${dt2.getFullYear()}${String(dt2.getMonth()+1).padStart(2,'0')}${String(dt2.getDate()).padStart(2,'0')}_${String(dt2.getHours()).padStart(2,'0')}${String(dt2.getMinutes()).padStart(2,'0')}${String(dt2.getSeconds()).padStart(2,'0')}`
        const templateName2 = safeFileName(getTemplateDisplayName((tpl as any).dir, String(slug)))
        const customerName2 = safeFileName(String(row.name))
        const defaultBase2 = `${customerName2}_${templateName2}_${dtStr2}`
        const baseName2 = filename || defaultBase2
        const fnameLocal = baseName2
        try { send({ type: 'info', templateName: templateName2, customerName: customerName2, outfile: fnameLocal + '.docx' }) } catch {}
        const outPathLocal = path.join(docsDir, fnameLocal + '.docx')
        try { jobLog(job.id, `outfile:${path.basename(outPathLocal)}`) } catch {}
        fs.writeFileSync(outPathLocal, merged)
        stepOkRec('mergeWrite')
        markJobDone(job.id, { path: outPathLocal, name: path.basename(outPathLocal) }, { usedWorkspace: wsForGen })
        send({ type: 'done', file: { path: outPathLocal, name: path.basename(outPathLocal) }, usedWorkspace: wsForGen, jobId: job.id })
      } else if ((tpl as any).kind === 'excel') {
        if (!result || !('sheets' in (result as any))) { jobLog(job.id, 'error:no-sheets'); markJobError(job.id, 'Full generator did not return sheets for Excel'); send({ type: 'error', error: 'Full generator did not return sheets for Excel' }); return res.end() }
        if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
        logAndPush('merge:start')
        stepStartRec('mergeWrite')
        const mergedBuf = await (await import('../services/excelComposeSheetJS')).mergeOpsIntoExcelTemplate(fs.readFileSync((tpl as any).templatePath), result)
        logAndPush('merge:ok')
        const dt2 = new Date()
        const dtStr2 = `${dt2.getFullYear()}${String(dt2.getMonth()+1).padStart(2,'0')}${String(dt2.getDate()).padStart(2,'0')}_${String(dt2.getHours()).padStart(2,'0')}${String(dt2.getMinutes()).padStart(2,'0')}${String(dt2.getSeconds()).padStart(2,'0')}`
        const templateName2 = safeFileName(getTemplateDisplayName((tpl as any).dir, String(slug)))
        const customerName2 = safeFileName(String(row.name))
        const defaultBase2 = `${customerName2}_${templateName2}_${dtStr2}`
        const baseName2 = filename || defaultBase2
        const fnameLocal = baseName2
        try { send({ type: 'info', templateName: templateName2, customerName: customerName2, outfile: fnameLocal + '.xlsx' }) } catch {}
        const outPathLocal = path.join(docsDir, fnameLocal + '.xlsx')
        try { jobLog(job.id, `outfile:${path.basename(outPathLocal)}`) } catch {}
        fs.writeFileSync(outPathLocal, mergedBuf)
        stepOkRec('mergeWrite')
        markJobDone(job.id, { path: outPathLocal, name: path.basename(outPathLocal) }, { usedWorkspace: wsForGen })
        send({ type: 'done', file: { path: outPathLocal, name: path.basename(outPathLocal) }, usedWorkspace: wsForGen, jobId: job.id })
      } else {
        jobLog(job.id, 'error:template-kind'); markJobError(job.id, 'Unsupported template kind for generation'); send({ type: 'error', error: 'Unsupported template kind for generation' }); return res.end()
      }
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

// Provide metadata for the file associated with a job so the client can open it natively
router.post("/jobs/:id/open-file", (req, res) => {
  try {
    const j = getJob(String(req.params.id))
    if (!j || !j.file?.path) return res.status(404).json({ error: 'Not found' })
    const root = libraryRoot()
    const resolved = path.resolve(String(j.file.path))
    if (!resolved.startsWith(path.resolve(root))) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'File not found' })
    }
    return res.json({ ok: true, path: resolved, extension: path.extname(resolved) })
  } catch (e:any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
})

router.delete("/jobs/:id", (req, res) => {
  try { deleteJob(String(req.params.id)); return res.json({ ok: true }) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

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

router.post("/cards", (req, res) => {
  const db = getDB()
  const body = req.body || {}
  const cardId = String(body.id || body.cardId || '').trim()
  const side = String(body.side || 'user').trim()
  const jobId = String(body.jobId || '').trim()
  const template = body.template != null ? String(body.template) : null
  const jobStatus = body.jobStatus != null ? String(body.jobStatus) : null
  const filename = body.filename != null ? String(body.filename) : null
  const aiContext = body.aiContext != null ? String(body.aiContext) : null
  const timestamp = Number(body.timestamp || Date.now())
  let workspaceSlug = body.workspaceSlug != null ? String(body.workspaceSlug) : null
  const customerId = body.customerId != null ? Number(body.customerId) : null

  if (!cardId || !jobId) return res.status(400).json({ error: 'cardId and jobId required' })
  if (!workspaceSlug && !customerId) return res.status(400).json({ error: 'workspaceSlug or customerId required' })

  const upsert = () => {
    db.run(
      `INSERT INTO gen_cards (cardId, workspaceSlug, customerId, side, template, jobId, jobStatus, filename, aiContext, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cardId) DO UPDATE SET
         workspaceSlug=excluded.workspaceSlug,
         customerId=excluded.customerId,
         side=excluded.side,
         template=excluded.template,
         jobId=excluded.jobId,
         jobStatus=excluded.jobStatus,
         filename=excluded.filename,
         aiContext=excluded.aiContext,
         timestamp=excluded.timestamp,
         updatedAt=CURRENT_TIMESTAMP
      `,
      [cardId, workspaceSlug, customerId, side, template, jobId, jobStatus, filename, aiContext, timestamp],
      function (err) {
        if (err) return res.status(500).json({ error: err.message })
        return res.json({ ok: true, id: cardId })
      }
    )
  }

  if (!workspaceSlug && customerId) {
    db.get<{ workspaceSlug?: string }>(
      'SELECT workspaceSlug FROM customers WHERE id = ?',
      [customerId],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message })
        workspaceSlug = row?.workspaceSlug || null
        upsert()
      }
    )
    return
  }
  upsert()
})

// List cards by workspace slug
router.get('/cards/by-workspace/:slug', (req, res) => {
  const db = getDB()
  const slug = String(req.params.slug)
  db.all(
    'SELECT cardId as id, workspaceSlug, customerId, side, template, jobId, jobStatus, filename, aiContext, timestamp, createdAt, updatedAt FROM gen_cards WHERE workspaceSlug = ? ORDER BY COALESCE(timestamp, 0), datetime(createdAt) ASC',
    [slug],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message })
      
      // Sync card status with actual job status
      const cards = (rows || []).map((card: any) => {
        if (card.jobId) {
          try {
            const job = getJob(card.jobId)
            if (job && job.status !== card.jobStatus) {
              // Update card status to match job status
              const updatedStatus = job.status
              const updatedFilename = job.file?.name || card.filename
              
              // Update in database
              db.run(
                'UPDATE gen_cards SET jobStatus = ?, filename = ? WHERE cardId = ?',
                [updatedStatus, updatedFilename, card.id],
                (updateErr) => {
                  if (updateErr) console.error('Failed to sync card status:', updateErr)
                }
              )
              
              // Return updated card
              return { ...card, jobStatus: updatedStatus, filename: updatedFilename }
            }
          } catch (e) {
            // Job not found, card status is canonical
          }
        }
        return card
      })
      
      return res.json({ cards })
    }
  )
})

// Delete cards by workspace slug
router.delete('/cards/by-workspace/:slug', (req, res) => {
  const db = getDB()
  const slug = String(req.params.slug)
  db.run('DELETE FROM gen_cards WHERE workspaceSlug = ?', [slug], function (err) {
    if (err) return res.status(500).json({ error: err.message })
    return res.json({ ok: true, deleted: this.changes || 0 })
  })
})

// Delete cards by customer id
router.delete('/cards/by-customer/:id', (req, res) => {
  const db = getDB()
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' })
  db.run('DELETE FROM gen_cards WHERE customerId = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message })
    return res.json({ ok: true, deleted: this.changes || 0 })
  })
})

// Delete cards by job id
router.delete('/cards/by-job/:jobId', (req, res) => {
  const db = getDB()
  const jobId = String(req.params.jobId)
  db.run('DELETE FROM gen_cards WHERE jobId = ?', [jobId], function (err) {
    if (err) return res.status(500).json({ error: err.message })
    return res.json({ ok: true, deleted: this.changes || 0 })
  })
})

