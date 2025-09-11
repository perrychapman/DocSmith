// backend/src/api/templates.ts
import { Router } from "express"
import fs from "fs"
import path from "path"
import { loadTemplate } from "../services/templateEngine"
import { safeSlug } from "../services/fs"
import { anythingllmRequest } from "../services/anythingllm"
import { createJob, appendLog as jobLog, markJobDone, markJobError, listJobs, getJob, cancelJob, isCancelled } from "../services/genJobs"
import { libraryRoot } from "../services/fs"
import { readSettings, writeSettings } from "../services/settings"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Handlebars = require('handlebars')
// Placeholder-based DOCX engines removed
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require("multer")
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PizZip = require('pizzip')

const router = Router()

const TEMPLATES_ROOT = path.join(libraryRoot(), "templates")

// List available templates (directory-based)
router.get("/", (_req, res) => {
  try {
    if (!fs.existsSync(TEMPLATES_ROOT)) fs.mkdirSync(TEMPLATES_ROOT, { recursive: true })
    const entries = fs.readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
    const items = entries
      .filter((e) => e.isDirectory())
      .map((d) => {
        try {
          const slug = d.name
          const dir = path.join(TEMPLATES_ROOT, slug)
          const hasHbs = fs.existsSync(path.join(dir, "template.hbs"))
          const hasDocx = fs.existsSync(path.join(dir, "template.docx"))
          const hasExcel = fs.existsSync(path.join(dir, "template.xlsx"))
          // Versioning disabled
          const versionCount = 0
          let hasSource = false
          try { hasSource = !!(fs.readdirSync(dir).find((n) => /^source\./i.test(n))) } catch {}
          const hasScript = false
          const hasHelperTs = false
          const hasFullGen = fs.existsSync(path.join(dir, "generator.full.ts"))
          let compiledAt: string | undefined
          try {
            if (hasFullGen) {
              const st = fs.statSync(path.join(dir, 'generator.full.ts'))
              compiledAt = st.mtime.toISOString()
            }
          } catch {}
          let updatedAt = new Date().toISOString()
          try { updatedAt = fs.statSync(dir).mtime.toISOString() } catch {}
          // Prefer friendly name derived from slug when template.json is absent
          let name: string | undefined
          let workspaceSlug: string | undefined
          try {
            const metaPath = path.join(dir, "template.json")
            if (fs.existsSync(metaPath)) {
              const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
              name = meta?.name
              workspaceSlug = meta?.workspaceSlug
            }
          } catch {}
          const friendly = require('../services/fs').displayNameFromSlug(slug)
          return { slug, name: (name || friendly || slug), hasTemplate: (hasHbs || hasDocx || hasExcel), hasDocx, hasExcel, hasSource, hasScript, hasHelperTs, hasFullGen, compiledAt, workspaceSlug, updatedAt, dir, versionCount }
        } catch {
          return { slug: d.name, name: d.name, hasTemplate: false, hasDocx: false, hasExcel: false, hasSource: false, hasScript: false, hasHelperTs: false, hasFullGen: false, updatedAt: new Date().toISOString(), dir: path.join(TEMPLATES_ROOT, d.name), versionCount: 0 }
        }
      })
    return res.json({ templates: items })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// Get one template's metadata
router.get("/:slug", (req, res) => {
  const slug = String(req.params.slug)
  const t = loadTemplate(slug, TEMPLATES_ROOT)
  if (!t) return res.status(404).json({ error: "Template not found" })
  return res.json({ slug, name: t.meta?.name || slug, meta: t.meta ? t.meta : {} })
})

// Helper endpoints removed

// Get the generated document generator (if any)
// Legacy docgen endpoint removed; only fullgen is supported

// Get the generated full document generator (if any)
router.get("/:slug/fullgen", (req, res) => {
  const slug = String(req.params.slug)
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    const file = path.join(dir, 'generator.full.ts')
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'No full generator found' })
    const code = fs.readFileSync(file, 'utf-8')
    return res.json({ code })
  } catch (e) { return res.status(500).json({ error: (e as Error).message }) }
})

// Legacy docgen rebuild removed; use /:slug/fullgen/rebuild

// New: Rebuild a full document generator (no placeholders). Writes generator.full.ts
router.post("/:slug/fullgen/rebuild", async (req, res) => {
  return res.status(410).json({ error: 'Endpoint deprecated. Use POST /api/templates/:slug/compile' })
})

// Preview template content (agnostic): original or compiled
router.get("/:slug/preview", async (req, res) => {
  const slug = String(req.params.slug)
  const variant = String(req.query.variant || 'original').toLowerCase()
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })

    const docxPath = path.join(dir, 'template.docx')
    const srcName = (fs.readdirSync(dir).find((n) => /^source\./i.test(n)) || '')
    const srcPath = srcName ? path.join(dir, srcName) : ''
    const tmplHbsPath = path.join(dir, 'template.hbs')
    const suggestedPath = path.join(dir, 'template.suggested.hbs')

    async function docxToText(bufOrPath: Buffer | string) {
      if (typeof bufOrPath === 'string') {
        const buffer = fs.readFileSync(bufOrPath)
        const result = await mammoth.extractRawText({ buffer })
        return String(result?.value || '')
      } else {
        const result = await mammoth.extractRawText({ buffer: bufOrPath })
        return String(result?.value || '')
      }
    }
    async function docxToHtml(bufOrPath: Buffer | string) {
      if (typeof bufOrPath === 'string') {
        const buffer = fs.readFileSync(bufOrPath)
        const result = await mammoth.convertToHtml({ buffer }, {
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Subtitle'] => h2:fresh",
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Heading 4'] => h4:fresh",
            "p[style-name='Heading 5'] => h5:fresh",
            "p[style-name='Heading 6'] => h6:fresh"
          ]
        })
        return String(result?.value || '')
      } else {
        const result = await mammoth.convertToHtml({ buffer: bufOrPath }, {
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Subtitle'] => h2:fresh",
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Heading 4'] => h4:fresh",
            "p[style-name='Heading 5'] => h5:fresh",
            "p[style-name='Heading 6'] => h6:fresh"
          ]
        })
        return String(result?.value || '')
      }
    }

    if (variant === 'original') {
      if (fs.existsSync(docxPath)) {
        const html = await docxToHtml(docxPath)
        return res.json({ html, source: 'docx', kind: 'html' })
      }
      if (srcPath) {
        const text = fs.readFileSync(srcPath, 'utf-8')
        return res.json({ text, source: path.basename(srcPath) })
      }
      if (fs.existsSync(tmplHbsPath)) {
        const text = fs.readFileSync(tmplHbsPath, 'utf-8')
        return res.json({ text, source: 'template.hbs' })
      }
      return res.status(404).json({ error: 'No previewable source found' })
    }

    // compiled preview removed; always fall back to raw extraction for DOCX
    if (fs.existsSync(docxPath)) {
      const html = await docxToHtml(docxPath)
      return res.json({ html, source: 'docx', kind: 'html' })
    }
    // For text templates: prefer suggested then compiled hbs
    const hbsFile = fs.existsSync(suggestedPath) ? suggestedPath : (fs.existsSync(tmplHbsPath) ? tmplHbsPath : '')
    if (hbsFile) {
      const body = fs.readFileSync(hbsFile, 'utf-8')
      const compiled = Handlebars.compile(body)
      const rendered = compiled({})
      // Heuristic: if template looks like HTML, return html
      const isHtml = /<html|<body|<div|<p|<h[1-6]|<table|<span/i.test(rendered)
      if (isHtml) return res.json({ html: rendered, source: path.basename(hbsFile), kind: 'html' })
      return res.json({ text: rendered, source: path.basename(hbsFile) })
    }
    if (srcPath) {
      const text = fs.readFileSync(srcPath, 'utf-8')
      return res.json({ text, source: path.basename(srcPath) })
    }
    return res.status(404).json({ error: 'No preview available' })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// Generate a PDF preview locally (no third-party upload)
// GET /api/templates/:slug/preview.pdf?variant=original
router.get("/:slug/preview.pdf", async (req, res) => {
  const slug = String(req.params.slug)
  const variant = String(req.query.variant || 'original').toLowerCase()
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })

    const docxPath = path.join(dir, 'template.docx')
    const srcName = (fs.readdirSync(dir).find((n) => /^source\./i.test(n)) || '')
    const srcPath = srcName ? path.join(dir, srcName) : ''
    const tmplHbsPath = path.join(dir, 'template.hbs')
    const suggestedPath = path.join(dir, 'suggested.hbs')

    // Resolve HTML for preview (prefer DOCX->HTML, else suggested/compiled HBS, else source)
    let html = ''
    async function docxToHtml(bufOrPath: string | Buffer): Promise<string> {
      if (typeof bufOrPath === 'string') {
        const buffer = fs.readFileSync(bufOrPath)
        const result = await mammoth.convertToHtml({ buffer }, { includeDefaultStyleMap: true })
        return String(result?.value || '')
      } else {
        const result = await mammoth.convertToHtml({ buffer: bufOrPath }, { includeDefaultStyleMap: true })
        return String(result?.value || '')
      }
    }

    if (fs.existsSync(docxPath)) {
      html = await docxToHtml(docxPath)
    } else {
      const hbsFile = fs.existsSync(suggestedPath) ? suggestedPath : (fs.existsSync(tmplHbsPath) ? tmplHbsPath : '')
      if (hbsFile) {
        const body = fs.readFileSync(hbsFile, 'utf-8')
        const compiled = Handlebars.compile(body)
        const rendered = compiled({})
        html = /<html|<body|<div|<p|<h[1-6]|<table|<span/i.test(rendered) ? rendered : `<pre>${rendered}</pre>`
      } else if (srcPath) {
        const ext = path.extname(srcPath).toLowerCase()
        const raw = fs.readFileSync(srcPath, 'utf-8')
        if (ext === '.md' || ext === '.markdown') {
          // Lazy import marked to avoid ESM/CJS friction
          const { marked } = await import('marked') as any
          html = String(marked.parse(raw))
        } else if (ext === '.html' || ext === '.htm') {
          html = raw
        } else {
          html = `<pre>${raw.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`
        }
      }
    }

    // Wrap HTML in a printable document (basic margins/typography)
    const htmlDoc = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            @page { margin: 0.5in; }
            body { font-family: Arial, Helvetica, sans-serif; color: #111; }
            h1,h2,h3,h4,h5,h6 { page-break-after: avoid; }
            table { border-collapse: collapse; width: 100%; }
            table, th, td { border: 1px solid #ddd; }
            th, td { padding: 4px 6px; }
            pre { white-space: pre-wrap; font-family: Consolas, Monaco, monospace; }
          </style>
        </head>
        <body>${html || ''}</body>
      </html>`

    // Render to PDF via Puppeteer (local, no network)
    const puppeteer = await import('puppeteer') as any
    // Use a headless mode compatible in many environments
    const browser = await (puppeteer as any).launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    try {
      const page = await browser.newPage()
      await page.setContent(htmlDoc, { waitUntil: 'load' })
      const pdf: Buffer = await page.pdf({
        printBackground: true,
        format: 'letter',
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
      })
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Disposition', `inline; filename="${slug}.preview.pdf"`)
      return res.send(pdf)
    } finally {
      await browser.close().catch(()=>{})
    }
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// Serve DOCX file (original or compiled-empty)
router.get("/:slug/file", async (req, res) => {
  const slug = String(req.params.slug)
  const variant = String(req.query.variant || 'original').toLowerCase()
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const docxPath = path.join(dir, 'template.docx')
    if (!fs.existsSync(docxPath)) return res.status(404).json({ error: 'No DOCX template for this slug' })

    // Always return the original; compiled placeholder rendering removed
    const buf: Buffer = fs.readFileSync(docxPath)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `inline; filename="${slug}.docx"`)
    res.setHeader('Cache-Control', 'no-store')
    return res.send(buf)
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// Placeholder inspection removed

export default router

// ---- Upload a raw template (docx or text) without compiling ----
// POST /api/templates/upload (multipart/form-data)
// fields: file, name? (display), slug? (folder)
const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    if (!fs.existsSync(TEMPLATES_ROOT)) fs.mkdirSync(TEMPLATES_ROOT, { recursive: true })
    cb(null, TEMPLATES_ROOT)
  },
  filename: (req: any, file: any, cb: any) => {
    const providedSlug = safeSlug(String((req.body?.slug || "").trim() || path.parse(file.originalname).name))
    const dir = path.join(TEMPLATES_ROOT, providedSlug)
    try { fs.mkdirSync(dir, { recursive: true }) } catch {}
    const ext = (path.extname(file.originalname) || ".txt").toLowerCase()
    cb(null, `${providedSlug}__upload${ext}`)
  }
})
const upload = multer({ storage })

router.post("/upload", (req, res) => {
  upload.single("file")(req as any, res as any, async (err: any) => {
    if (err) return res.status(400).json({ error: String(err?.message || err) })
    try {
      const f = (req as any).file as { filename: string; path: string } | undefined
      if (!f) return res.status(400).json({ error: "No file uploaded" })
      const providedSlug = safeSlug(String((req.body?.slug || "").trim() || path.parse(f.filename).name.replace(/__upload$/, "")))
      const dir = path.join(TEMPLATES_ROOT, providedSlug)
      fs.mkdirSync(dir, { recursive: true })
      const ext = (path.extname(f.filename) || ".txt").toLowerCase()
      const isDocx = ext === ".docx"
      const isExcel = ext === ".xlsx"
      const target = path.join(dir, isDocx ? `template.docx` : (isExcel ? `template.xlsx` : `source${ext}`))
      fs.renameSync(f.path, target)
      // Write/merge template.json
      const metaPath = path.join(dir, 'template.json')
      let meta: any = {}
      try { if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath,'utf-8')) } catch {}
      const name = String((req.body?.name || meta?.name || providedSlug)).trim()
      const fmt = isDocx ? 'docx' : (isExcel ? 'excel' : (ext === '.html' ? 'html' : (ext === '.md' || ext === '.markdown' ? 'md' : 'txt')))
      // Do not set a default filenamePattern here; backend will apply
      // a global default of {Customer}_{TemplateName}_{YYYYMMDD_HHmmss}.
      // Preserve any existing explicit pattern only.
      const existingPattern = (meta?.output?.filenamePattern ? String(meta.output.filenamePattern) : undefined)
      meta = { ...meta, name, output: { format: fmt, ...(existingPattern ? { filenamePattern: existingPattern } : {}) } }
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

      // Ensure AnythingLLM workspace and upload template file to it
      let wsSlug: string | undefined = meta?.workspaceSlug
      try {
        const wsName = `Template_${providedSlug}`
        const list = await anythingllmRequest<any>("/workspaces", "GET")
        const arr: Array<{ name?: string; slug?: string }> = Array.isArray((list as any)?.workspaces) ? (list as any).workspaces : (Array.isArray(list) ? (list as any) : [])
        wsSlug = wsSlug || arr.find((w) => (w.name || "") === wsName)?.slug
        if (!wsSlug) {
          const created = await anythingllmRequest<any>("/workspace/new", "POST", { name: wsName })
          wsSlug = created?.workspace?.slug
        }
        if (wsSlug) {
          try {
            const fd = new FormData()
            const buf = fs.readFileSync(target)
            const uint = new Uint8Array(buf)
            // @ts-ignore
            const theFile = new File([uint], path.basename(target))
            fd.append("file", theFile)
            fd.append("addToWorkspaces", wsSlug)
            await anythingllmRequest<any>("/document/upload", "POST", fd)
          } catch {}
          // Persist workspace slug
          try { const cur = JSON.parse(fs.readFileSync(metaPath,'utf-8')); cur.workspaceSlug = wsSlug; fs.writeFileSync(metaPath, JSON.stringify(cur, null, 2), 'utf-8') } catch {}
        }
      } catch {}

      // Do not compile here; user triggers compile explicitly later
      return res.status(201).json({ ok: true, slug: providedSlug, workspaceSlug: wsSlug })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  })
})

// ---- Compile a template with AI into Handlebars and schema ----
// POST /api/templates/:slug/compile
router.post("/:slug/compile", async (req, res) => {
  const slug = String(req.params.slug)
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const metaPath = path.join(dir, 'template.json')
    let wsSlug: string | undefined
    try { const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); if (meta?.workspaceSlug) wsSlug = String(meta.workspaceSlug) } catch {}
    if (!wsSlug) return res.status(400).json({ error: 'No workspace associated with this template' })

    // Extract skeleton from docx/html/text for the AI to mirror structure
    let skeleton = ''
    try {
      const docxPath = path.join(dir, 'template.docx')
      if (fs.existsSync(docxPath)) {
        const buffer = fs.readFileSync(docxPath)
        const result = await (mammoth as any).convertToHtml({ buffer }, { styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh"
        ], includeDefaultStyleMap: true })
        skeleton = String(result?.value || '')
        // Try to extract style/header/footer XML excerpts to guide formatting
        try {
          const zip = new PizZip(buffer)
          const stylesXml = zip.file('word/styles.xml')?.asText() || ''
          const stylesFxXml = zip.file('word/stylesWithEffects.xml')?.asText() || ''
          const numberingXml = zip.file('word/numbering.xml')?.asText() || ''
          const documentXml = zip.file('word/document.xml')?.asText() || ''
          const themeXml = zip.file('word/theme/theme1.xml')?.asText() || ''
          const header1 = zip.file('word/header1.xml')?.asText() || ''
          const header2 = zip.file('word/header2.xml')?.asText() || ''
          const footer1 = zip.file('word/footer1.xml')?.asText() || ''
          const footer2 = zip.file('word/footer2.xml')?.asText() || ''
          const take = (s: string, n = 8000) => (s ? s.slice(0, n) : '')
          const stylesHint = take(stylesXml)
          const stylesFxHint = take(stylesFxXml)
          const numberingHint = take(numberingXml)
          const documentHint = take(documentXml)
          const themeHint = take(themeXml)
          const headersHint = take((header1 + '\n' + header2).trim())
          const footersHint = take((footer1 + '\n' + footer2).trim())

          const parts: string[] = []
          parts.push('TEMPLATE SKELETON (HTML excerpt):')
          parts.push('---')
          parts.push(skeleton.slice(0,12000))
          parts.push('---')
          if (stylesHint) { parts.push('STYLES XML (excerpt):','---', stylesHint, '---') }
          if (stylesFxHint) { parts.push('STYLES WITH EFFECTS XML (excerpt):','---', stylesFxHint, '---') }
          if (numberingHint) { parts.push('NUMBERING XML (excerpt):','---', numberingHint, '---') }
          if (documentHint) { parts.push('DOCUMENT XML (excerpt):','---', documentHint, '---') }
          if (themeHint) { parts.push('THEME XML (excerpt):','---', themeHint, '---') }
          if (headersHint) { parts.push('HEADERS XML (excerpt):','---', headersHint, '---') }
          if (footersHint) { parts.push('FOOTERS XML (excerpt):','---', footersHint, '---') }
          skeleton = parts.join('\n')
        } catch {}
      } else {
        const src = (fs.readdirSync(dir).find((n)=>/^source\./i.test(n))||'')
        if (src) skeleton = fs.readFileSync(path.join(dir, src), 'utf-8')
        else if (fs.existsSync(path.join(dir,'template.hbs'))) skeleton = fs.readFileSync(path.join(dir,'template.hbs'),'utf-8')
      }
    } catch {}

    const prompt = `You are a senior TypeScript engineer and document automation specialist. Recreate this template faithfully while preserving layout, headers/footers, spacing, lists, tables, images, hyperlinks, and emphasis.\n\nOutput: ONLY TypeScript code that returns raw WordprocessingML (WML).\n\nExport exactly:\nexport async function generate(\n  toolkit: { json: (prompt: string) => Promise<any>; text: (prompt: string) => Promise<string>; query?: (prompt: string) => Promise<any>; getSkeleton?: (kind?: 'html'|'text') => Promise<string> },\n  builder: any,\n  context?: Record<string, any>\n): Promise<{ wml: string }>;\n\nHard requirements:\n- Return ONLY { wml } containing the inner <w:body> children (<w:p>, <w:tbl>, ...). Do NOT include <w:sectPr> or any package-level parts.\n- Mirror the TEMPLATE SKELETON (prefer HTML skeleton) for headings/order/grouping.\n- Apply formatting in WML: run properties (color, size, bold/italic/underline/strike, font) and paragraph properties (alignment, spacing, indents), table widths/styles, list/numbering with <w:numPr> matching template numbering.\n- Use STYLES, THEME, and NUMBERING XML excerpts to choose brand colors, fonts, and list styles. Convert theme colors to hex where needed.\n- Do NOT output HTML, Markdown, or a DOCX buffer. No external imports or file I/O.\n- Do NOT add any sections, paragraphs, tables, or content that are not present in the provided skeleton; if unsure, omit rather than invent.\n- Preserve styling exactly; do not change fonts, colors, sizes, spacing, numbering, or table properties beyond what the skeleton and excerpts imply.\n\nTEMPLATE ARTIFACTS (HTML skeleton + XML excerpts):\n${skeleton}`

    const chat = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(wsSlug))}/chat`, 'POST', { message: prompt, mode: 'query' })
    const text = String(chat?.textResponse || chat?.message || chat || '')
    let code = text
    const m = text.match(/```[a-z]*\s*([\s\S]*?)```/i)
    if (m && m[1]) code = m[1]
    code = code.trim()
    if (!code) return res.status(502).json({ error: 'No code returned' })
    fs.writeFileSync(path.join(dir,'generator.full.ts'), code, 'utf-8')
    return res.json({ ok: true, slug, usedWorkspace: wsSlug, generated: 'generator.full.ts' })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// Live compile (SSE) with logs, steps, cancel
router.get("/:slug/compile/stream", async (req, res) => {
  const slug = String(req.params.slug)
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Template not found' })}\n\n`)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const send = (obj: any) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`) } catch {} }
    const log = (m: string) => send({ type: 'log', message: m })
    const steps = ['resolveTemplate','resolveWorkspace','readTemplate','extractSkeleton','buildPrompt','aiRequest','writeGenerator']
    const totalSteps = steps.length
    let completed = 0
    const stepStart = (name: string) => send({ type: 'step', name, status: 'start', progress: Math.round((completed/totalSteps)*100) })
    const stepOk = (name: string) => { completed = Math.min(totalSteps, completed + 1); send({ type: 'step', name, status: 'ok', progress: Math.round((completed/totalSteps)*100) }) }

    const metaPath = path.join(dir, 'template.json')
    let wsSlug: string | undefined
    try { const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); if (meta?.workspaceSlug) wsSlug = String(meta.workspaceSlug) } catch {}
    if (!wsSlug) { send({ type: 'error', error: 'No workspace associated with this template' }); return res.end() }
    stepOk('resolveTemplate')
    send({ type: 'info', usedWorkspace: wsSlug })
    stepOk('resolveWorkspace')

    const job = createJob({ customerId: 0, customerName: 'template', template: slug, filename: 'generator.full.ts', usedWorkspace: wsSlug })
    send({ type: 'info', jobId: job.id })
    const logPush = (m:string) => { log(m); jobLog(job.id, m) }

    // Extract skeleton and XML hints
    stepStart('readTemplate')
    let skeleton = ''
    try {
      const docxPath = path.join(dir, 'template.docx')
      if (fs.existsSync(docxPath)) {
        const buffer = fs.readFileSync(docxPath)
        stepOk('readTemplate')
        stepStart('extractSkeleton')
        const result = await (mammoth as any).convertToHtml({ buffer }, { styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh"
        ], includeDefaultStyleMap: true })
        const html = String(result?.value || '')
        try {
          const zip = new PizZip(buffer)
          const stylesXml = zip.file('word/styles.xml')?.asText() || ''
          const stylesFxXml = zip.file('word/stylesWithEffects.xml')?.asText() || ''
          const numberingXml = zip.file('word/numbering.xml')?.asText() || ''
          const documentXml = zip.file('word/document.xml')?.asText() || ''
          const themeXml = zip.file('word/theme/theme1.xml')?.asText() || ''
          const header1 = zip.file('word/header1.xml')?.asText() || ''
          const header2 = zip.file('word/header2.xml')?.asText() || ''
          const footer1 = zip.file('word/footer1.xml')?.asText() || ''
          const footer2 = zip.file('word/footer2.xml')?.asText() || ''
          const take = (s: string, n = 8000) => (s ? s.slice(0, n) : '')
          const parts: string[] = []
          parts.push('TEMPLATE SKELETON (HTML excerpt):','---', html.slice(0,12000), '---')
          if (stylesXml) { parts.push('STYLES XML (excerpt):','---', take(stylesXml), '---') }
          if (stylesFxXml) { parts.push('STYLES WITH EFFECTS XML (excerpt):','---', take(stylesFxXml), '---') }
          if (numberingXml) { parts.push('NUMBERING XML (excerpt):','---', take(numberingXml), '---') }
          if (documentXml) { parts.push('DOCUMENT XML (excerpt):','---', take(documentXml), '---') }
          if (themeXml) { parts.push('THEME XML (excerpt):','---', take(themeXml), '---') }
          const headersHint = (header1 + '\n' + header2).trim()
          const footersHint = (footer1 + '\n' + footer2).trim()
          if (headersHint) { parts.push('HEADERS XML (excerpt):','---', take(headersHint), '---') }
          if (footersHint) { parts.push('FOOTERS XML (excerpt):','---', take(footersHint), '---') }
          skeleton = parts.join('\n')
        } catch {
          skeleton = html
        }
        stepOk('extractSkeleton')
      } else {
        const src = (fs.readdirSync(dir).find((n)=>/^source\./i.test(n))||'')
        if (src) { skeleton = fs.readFileSync(path.join(dir, src), 'utf-8'); stepOk('readTemplate'); stepOk('extractSkeleton') }
        else if (fs.existsSync(path.join(dir,'template.hbs'))) { skeleton = fs.readFileSync(path.join(dir,'template.hbs'),'utf-8'); stepOk('readTemplate'); stepOk('extractSkeleton') }
      }
    } catch { /* ignore; skeleton may be empty */ }

    // Build prompt
    stepStart('buildPrompt')
      const prompt = `You are a senior TypeScript engineer and document automation specialist. Recreate this template faithfully while preserving layout, headers/footers, spacing, lists, tables, images, hyperlinks, and emphasis.\n\nOutput: ONLY TypeScript code that returns raw WordprocessingML (WML).\n\nExport exactly:\nexport async function generate(\n  toolkit: { json: (prompt: string) => Promise<any>; text: (prompt: string) => Promise<string>; query?: (prompt: string) => Promise<any>; getSkeleton?: (kind?: 'html'|'text') => Promise<string> },\n  builder: any,\n  context?: Record<string, any>\n): Promise<{ wml: string }>;\n\nHard requirements:\n- Return ONLY { wml } containing the inner <w:body> children (<w:p>, <w:tbl>, ...). Do NOT include <w:sectPr> or any package-level parts.\n- Mirror the TEMPLATE SKELETON (prefer HTML skeleton) for headings/order/grouping.\n- Apply formatting in WML: run properties (color, size, bold/italic/underline/strike, font) and paragraph properties (alignment, spacing, indents), table widths/styles, list/numbering with <w:numPr> matching template numbering.\n- Use STYLES, THEME, and NUMBERING XML excerpts to choose brand colors, fonts, and list styles. Convert theme colors to hex where needed.\n- Do NOT output HTML, Markdown, or a DOCX buffer. No external imports or file I/O.\n- Do NOT add any sections, paragraphs, tables, or content that are not present in the provided skeleton; if unsure, omit rather than invent.\n- Preserve styling exactly; do not change fonts, colors, sizes, spacing, numbering, or table properties beyond what the skeleton and excerpts imply.\n\nTEMPLATE ARTIFACTS (HTML skeleton + XML excerpts):\n${skeleton}`
    stepOk('buildPrompt')

    // AI request
    stepStart('aiRequest')
    try {
      if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
      const chat = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(wsSlug))}/chat`, 'POST', { message: prompt, mode: 'query' })
      const text = String(chat?.textResponse || chat?.message || chat || '')
      let code = text
      const m = text.match(/```[a-z]*\s*([\s\S]*?)```/i)
      if (m && m[1]) code = m[1]
      code = code.trim()
      stepOk('aiRequest')

      // Write generator
      stepStart('writeGenerator')
      if (!code) { send({ type: 'error', error: 'No code returned' }); return res.end() }
      fs.writeFileSync(path.join(dir,'generator.full.ts'), code, 'utf-8')
      stepOk('writeGenerator')
      markJobDone(job.id, { path: path.join(dir,'generator.full.ts'), name: 'generator.full.ts' }, { usedWorkspace: wsSlug })
      return send({ type: 'done', file: { path: path.join(dir,'generator.full.ts'), name: 'generator.full.ts' }, usedWorkspace: wsSlug, jobId: job.id })
    } catch (e:any) {
      const msg = String(e?.message || e)
      jobLog(job.id, `error:${msg}`)
      markJobError(job.id, msg)
      return send({ type: 'error', error: msg })
    } finally {
      return res.end()
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ type: 'error', error: (e as Error).message })}\n\n`)
    return res.end()
  }
})

// Open the template folder on the server machine (local UX)
router.post("/:slug/open", async (req, res) => {
  try {
    const slug = String(req.params.slug)
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const platform = process.platform
    const { execFile } = await import('child_process')
    const openCmd = platform === 'win32' ? 'explorer' : (platform === 'darwin' ? 'open' : 'xdg-open')
    execFile(openCmd, [dir], { windowsHide: true }, (err) => {
      if (err) return res.status(500).json({ error: String(err.message || err) })
      return res.json({ ok: true })
    })
  } catch (e) { return res.status(500).json({ error: (e as Error).message }) }
})

// Alias for consistency with Jobs page
router.post("/:slug/reveal", async (req, res) => {
  try {
    const slug = String(req.params.slug)
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const platform = process.platform
    const { execFile } = await import('child_process')
    const openCmd = platform === 'win32' ? 'explorer' : (platform === 'darwin' ? 'open' : 'xdg-open')
    execFile(openCmd, [dir], { windowsHide: true }, (err) => {
      if (err) return res.status(500).json({ error: String(err.message || err) })
      return res.json({ ok: true })
    })
  } catch (e) { return res.status(500).json({ error: (e as Error).message }) }
})

// GET alias for reveal to match frontend fetch
router.get("/:slug/reveal", async (req, res) => {
  try {
    const slug = String(req.params.slug)
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const platform = process.platform
    const { execFile } = await import('child_process')
    const openCmd = platform === 'win32' ? 'explorer' : (platform === 'darwin' ? 'open' : 'xdg-open')
    execFile(openCmd, [dir], { windowsHide: true }, (err) => {
      if (err) return res.status(500).json({ error: String(err.message || err) })
      return res.json({ ok: true })
    })
  } catch (e) { return res.status(500).json({ error: (e as Error).message }) }
})

// Match Customers page convention: POST /api/templates/:slug/open-folder
router.post("/:slug/open-folder", async (req, res) => {
  try {
    const slug = String(req.params.slug)
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const platform = process.platform
    const { spawn } = await import('child_process')
    let cmd = ''
    let args: string[] = []
    if (platform === 'win32') { cmd = 'explorer'; args = [dir] }
    else if (platform === 'darwin') { cmd = 'open'; args = [dir] }
    else { cmd = 'xdg-open'; args = [dir] }
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
      child.unref()
      return res.json({ ok: true })
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message })
    }
  } catch (e) { return res.status(500).json({ error: (e as Error).message }) }
})

// Alternative path shape to avoid any routing edge cases
router.post("/reveal/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug)
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const platform = process.platform
    const { execFile } = await import('child_process')
    const openCmd = platform === 'win32' ? 'explorer' : (platform === 'darwin' ? 'open' : 'xdg-open')
    execFile(openCmd, [dir], { windowsHide: true }, (err) => {
      if (err) return res.status(500).json({ error: String(err.message || err) })
      return res.json({ ok: true })
    })
  } catch (e) { return res.status(500).json({ error: (e as Error).message }) }
})

router.get("/reveal/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug)
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const platform = process.platform
    const { execFile } = await import('child_process')
    const openCmd = platform === 'win32' ? 'explorer' : (platform === 'darwin' ? 'open' : 'xdg-open')
    execFile(openCmd, [dir], { windowsHide: true }, (err) => {
      if (err) return res.status(500).json({ error: String(err.message || err) })
      return res.json({ ok: true })
    })
  } catch (e) { return res.status(500).json({ error: (e as Error).message }) }
})

// Generate a PDF preview locally (no third-party upload)
// GET /api/templates/:slug/preview.pdf?variant=original
router.get("/:slug/preview.pdf", async (req, res) => {
  const slug = String(req.params.slug)
  const variant = String(req.query.variant || 'original').toLowerCase()
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })

    const docxPath = path.join(dir, 'template.docx')
    const srcName = (fs.readdirSync(dir).find((n) => /^source\./i.test(n)) || '')
    const srcPath = srcName ? path.join(dir, srcName) : ''
    const tmplHbsPath = path.join(dir, 'template.hbs')
    const suggestedPath = path.join(dir, 'suggested.hbs')

    // DOCX: Pure-JS conversion using Mammoth -> HTML, then render to PDF via Puppeteer
    if (fs.existsSync(docxPath)) {
      const buffer = fs.readFileSync(docxPath)
      // Extract page size, margins, and default font to improve fidelity
      let pageCss = "@page { size: 8.5in 11in; margin: 0.75in; }"
      let bodyFontCss = "body { font-family: 'Times New Roman', Georgia, serif; font-size: 12pt; color: #111; }"
      try {
        const zip = new (PizZip as any)(buffer)
        const docXml = zip.file('word/document.xml')?.asText() || ''
        const stylesXml = zip.file('word/styles.xml')?.asText() || ''
        // Page size and margins from sectPr
        const sectMatch = docXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)
        if (sectMatch) {
          const sect = sectMatch[0]
          const pgSz = sect.match(/<w:pgSz[^>]*?\/>/)
          const pgMar = sect.match(/<w:pgMar[^>]*?\/>/)
          const twip = (v: string | undefined) => {
            const n = v ? parseInt(v, 10) : NaN
            return isFinite(n) ? (n / 1440) : NaN // twips to inches
          }
          let wIn = 8.5, hIn = 11
          if (pgSz) {
            const w = /w:w=\"(\d+)\"/.exec(pgSz[0])?.[1]
            const h = /w:h=\"(\d+)\"/.exec(pgSz[0])?.[1]
            const orient = /w:orient=\"([^\"]+)\"/.exec(pgSz[0])?.[1]
            const wi = twip(w)
            const hi = twip(h)
            if (isFinite(wi) && isFinite(hi)) { wIn = wi; hIn = hi }
            if (orient === 'landscape' && wIn < hIn) { const t = wIn; wIn = hIn; hIn = t }
          }
          let mt = 0.75, mr = 0.75, mb = 0.75, ml = 0.75
          if (pgMar) {
            const top = /w:top=\"(\d+)\"/.exec(pgMar[0])?.[1]
            const right = /w:right=\"(\d+)\"/.exec(pgMar[0])?.[1]
            const bottom = /w:bottom=\"(\d+)\"/.exec(pgMar[0])?.[1]
            const left = /w:left=\"(\d+)\"/.exec(pgMar[0])?.[1]
            const ti = twip(top), ri = twip(right), bi = twip(bottom), li = twip(left)
            mt = isFinite(ti) ? ti : mt
            mr = isFinite(ri) ? ri : mr
            mb = isFinite(bi) ? bi : mb
            ml = isFinite(li) ? li : ml
          }
          pageCss = `@page { size: ${wIn.toFixed(2)}in ${hIn.toFixed(2)}in; margin: ${mt.toFixed(2)}in ${mr.toFixed(2)}in ${mb.toFixed(2)}in ${ml.toFixed(2)}in; }`
        }
        // Default font from styles
        const rFonts = /<w:rPrDefault>[\s\S]*?<w:rFonts[^>]*\/>/.exec(stylesXml)?.[0] || ''
        const fontAscii = /w:ascii=\"([^\"]+)\"/.exec(rFonts)?.[1]
        const fontSzVal = /<w:sz[^>]*w:val=\"(\d+)\"/.exec(stylesXml)?.[1]
        const fontSzPt = fontSzVal ? (parseInt(fontSzVal, 10) / 2) : 12
        if (fontAscii) {
          bodyFontCss = `body { font-family: '${fontAscii}', 'Times New Roman', Georgia, serif; font-size: ${fontSzPt}pt; color: #111; }`
        } else {
          bodyFontCss = `body { font-family: 'Times New Roman', Georgia, serif; font-size: ${fontSzPt}pt; color: #111; }`
        }
      } catch {}
      const result = await (mammoth as any).convertToHtml({ buffer }, {
        includeDefaultStyleMap: true,
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh"
        ],
        convertImage: (mammoth as any).images?.inline?.(async (element: any) => {
          const image = await element.read('base64')
          const contentType = element.contentType
          return { src: `data:${contentType};base64,${image}` }
        })
      })
      const html = String(result?.value || '')
      const htmlDoc = `<!doctype html><html><head><meta charset=\"utf-8\" />
        <style>
          ${pageCss}
          ${bodyFontCss}
          h1 { font-size: 20pt; margin: 0.3in 0 0.15in; }
          h2 { font-size: 16pt; margin: 0.25in 0 0.12in; }
          h3 { font-size: 14pt; margin: 0.2in 0 0.1in; }
          p { margin: 0.08in 0; line-height: 1.3; }
          img { max-width: 100%; }
        </style>
      </head><body>${html}</body></html>`
      const puppeteer = await import('puppeteer') as any
      const browser = await (puppeteer as any).launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] })
      try {
        const page = await browser.newPage()
        await page.setContent(htmlDoc, { waitUntil: 'load' })
        const pdf: Buffer = await page.pdf({ printBackground: true, format: 'letter', margin: { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' } })
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Disposition', `inline; filename="${slug}.preview.pdf"`)
        return res.send(pdf)
      } finally { await browser.close().catch(()=>{}) }
    }

    // Non-DOCX: build PDF via Puppeteer (markdown/html/txt)
    let html = ''
    if (fs.existsSync(suggestedPath) || fs.existsSync(tmplHbsPath)) {
      const hbsFile = fs.existsSync(suggestedPath) ? suggestedPath : tmplHbsPath
      const body = fs.readFileSync(hbsFile, 'utf-8')
      const compiled = Handlebars.compile(body)
      const rendered = compiled({})
      html = /<html|<body|<div|<p|<h[1-6]|<table|<span/i.test(rendered) ? rendered : `<pre>${rendered}</pre>`
    } else if (srcPath) {
      const ext = path.extname(srcPath).toLowerCase()
      const raw = fs.readFileSync(srcPath, 'utf-8')
      if (ext === '.md' || ext === '.markdown') {
        const { marked } = await import('marked') as any
        html = String(marked.parse(raw))
      } else if (ext === '.html' || ext === '.htm') {
        html = raw
      } else {
        html = `<pre>${raw.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`
      }
    } else {
      html = '<div style="color:#666">No previewable content</div>'
    }
    const wrap = `<!doctype html><html><head><meta charset=\"utf-8\" /><style>@page{margin:0.5in}body{font-family:Arial,Helvetica,sans-serif;color:#111}</style></head><body>${html}</body></html>`
    const puppeteer = await import('puppeteer') as any
    const browser = await (puppeteer as any).launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] })
    try {
      const page = await browser.newPage()
      await page.setContent(wrap, { waitUntil: 'load' })
      const pdf: Buffer = await page.pdf({ printBackground: true, format: 'letter', margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' } })
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Disposition', `inline; filename="${slug}.preview.pdf"`)
      return res.send(pdf)
    } finally { await browser.close().catch(()=>{}) }
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// Compile jobs list
router.get("/compile/jobs", (_req, res) => {
  try { return res.json({ jobs: listJobs(50) }) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

// Compile job details
router.get("/compile/jobs/:id", (req, res) => {
  try { const j = getJob(String(req.params.id)); if (!j) return res.status(404).json({ error: 'Not found' }); return res.json(j) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

// Cancel compile job
router.post("/compile/jobs/:id/cancel", (req, res) => {
  try { cancelJob(String(req.params.id)); return res.json({ ok: true }) } catch (e:any) { return res.status(500).json({ error: String(e?.message || e) }) }
})

// ---- Delete a template folder ----
router.delete("/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim()
  if (!slug) return res.status(400).json({ error: "Missing slug" })
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    const safeRoot = path.resolve(TEMPLATES_ROOT)
    const safeDir = path.resolve(dir)
    if (!safeDir.startsWith(safeRoot)) return res.status(400).json({ error: "Invalid path" })
    if (!fs.existsSync(safeDir)) return res.status(404).json({ error: "Template not found" })

    // Attempt to delete associated AnythingLLM workspace first (best-effort)
    let workspaceDeleted = false
    let workspaceSlug: string | undefined
    try {
      const metaPath = path.join(safeDir, 'template.json')
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        workspaceSlug = meta?.workspaceSlug
      }
      if (workspaceSlug) {
        try {
          await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(workspaceSlug))}`, 'DELETE')
          workspaceDeleted = true
        } catch (e) {
          // ignore; surface as not deleted
        }
      }
    } catch {}

    // Remove local folder
    try { fs.rmSync(safeDir, { recursive: true, force: true }) } catch {}
    return res.json({ ok: true, deleted: slug, ...(workspaceSlug ? { workspaceSlug } : {}), workspaceDeleted })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})
// Versioning routes removed; single upload endpoint above handles both new and replacement uploads without version history.
