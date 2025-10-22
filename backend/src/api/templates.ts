import { Router } from "express"
import fs from "fs"
import path from "path"
import { loadTemplate } from "../services/templateEngine"
import { safeSlug } from "../services/fs"
import { anythingllmRequest } from "../services/anythingllm"
import { createJob, appendLog as jobLog, markJobDone, markJobError, listJobs, getJob, cancelJob, isCancelled } from "../services/genJobs"
import { libraryRoot } from "../services/fs"
import { readSettings, writeSettings } from "../services/settings"
import { analyzeDocumentIntelligently } from "../services/documentIntelligence"
import { analyzeTemplateMetadata, saveTemplateMetadata, loadTemplateMetadata, loadAllTemplateMetadata, deleteTemplateMetadata } from "../services/templateMetadata"
import { buildMetadataEnhancedContext } from "../services/metadataMatching"
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

// In-memory notification store for template metadata extraction events
type TemplateMetadataNotification = {
  templateSlug: string
  status: 'processing' | 'complete' | 'error'
  message?: string
  metadata?: any
  timestamp: number
}

const templateMetadataNotifications: TemplateMetadataNotification[] = []
const MAX_TEMPLATE_NOTIFICATIONS = 100
const TEMPLATE_DEDUP_WINDOW_MS = 2000 // 2 seconds

function addTemplateNotification(notification: TemplateMetadataNotification) {
  // Prevent duplicate notifications for same template within short time window
  const recent = templateMetadataNotifications.find(
    n => n.templateSlug === notification.templateSlug &&
         n.status === notification.status &&
         (Date.now() - n.timestamp) < TEMPLATE_DEDUP_WINDOW_MS
  )
  
  if (recent) {
    console.log(`[TEMPLATE-METADATA-NOTIF] Skipping duplicate ${notification.status} notification for ${notification.templateSlug}`)
    return
  }
  
  templateMetadataNotifications.unshift(notification)
  if (templateMetadataNotifications.length > MAX_TEMPLATE_NOTIFICATIONS) {
    templateMetadataNotifications.pop()
  }
}

/**
 * Extracts template metadata in the background after successful upload
 */
async function extractTemplateMetadataInBackground(
  templateSlug: string,
  templateName: string,
  templatePath: string,
  workspaceSlug: string
): Promise<void> {
  // Notify: processing started
  addTemplateNotification({
    templateSlug,
    status: 'processing',
    message: 'Analyzing template structure and requirements...',
    timestamp: Date.now()
  })
  
  try {
    console.log(`[TEMPLATE-METADATA] Starting background extraction for ${templateSlug}`)
    console.log(`[TEMPLATE-METADATA] Workspace: ${workspaceSlug}`)
    console.log(`[TEMPLATE-METADATA] Template file: ${path.basename(templatePath)}`)
    
    // Wait for AnythingLLM to finish indexing the template with retries
    // Production builds may take longer than dev mode
    const maxWaitTime = 30000 // 30 seconds max
    const checkInterval = 2000 // Check every 2 seconds
    const startTime = Date.now()
    let isIndexed = false
    const templateFileName = path.basename(templatePath)
    
    console.log(`[TEMPLATE-METADATA] Waiting for template to be indexed (max ${maxWaitTime/1000}s)...`)
    
    while (!isIndexed && (Date.now() - startTime) < maxWaitTime) {
      try {
        // Check if template file exists in workspace embeddings
        const workspaceInfo = await anythingllmRequest<any>(
          `/workspace/${encodeURIComponent(workspaceSlug)}`,
          'GET'
        )
        
        const documents = workspaceInfo?.workspace?.documents || []
        const foundDoc = documents.find((d: any) => 
          d.docpath?.includes(templateFileName) ||
          d.name?.includes(templateFileName) ||
          d.location?.includes(templateFileName)
        )
        
        if (foundDoc) {
          console.log(`[TEMPLATE-METADATA] Template indexed successfully after ${((Date.now() - startTime)/1000).toFixed(1)}s`)
          isIndexed = true
          break
        }
        
        console.log(`[TEMPLATE-METADATA] Template not yet indexed, waiting ${checkInterval/1000}s... (${((Date.now() - startTime)/1000).toFixed(1)}s elapsed)`)
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      } catch (err) {
        console.error(`[TEMPLATE-METADATA] Error checking indexing status:`, err)
        // Continue waiting - might just be a transient error
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }
    
    if (!isIndexed) {
      console.log(`[TEMPLATE-METADATA] Template not indexed after ${maxWaitTime/1000}s, proceeding anyway (might be slow indexing)`)
      // Proceed anyway - the template might still be queryable even if not showing in workspace.documents yet
    }
    
    // Retry logic for metadata analysis (sometimes first attempt fails if template still indexing)
    console.log(`[TEMPLATE-METADATA] Sending AI analysis request for "${templateName}"`)
    let metadata: any = null
    let lastError: Error | null = null
    const maxRetries = 3
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[TEMPLATE-METADATA] Analysis attempt ${attempt}/${maxRetries}`)
        metadata = await analyzeTemplateMetadata(templatePath, templateSlug, templateName, workspaceSlug)
        
        // Check if we got meaningful metadata (not just fallback)
        if (metadata.templateType || metadata.purpose || (metadata.requiredDataTypes && metadata.requiredDataTypes.length > 0)) {
          console.log(`[TEMPLATE-METADATA] Analysis successful on attempt ${attempt}`)
          break
        } else {
          console.log(`[TEMPLATE-METADATA] Got fallback metadata on attempt ${attempt}, retrying...`)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 3000)) // Wait 3s before retry
          }
        }
      } catch (err) {
        lastError = err as Error
        console.error(`[TEMPLATE-METADATA] Analysis attempt ${attempt} failed:`, err)
        if (attempt < maxRetries) {
          console.log(`[TEMPLATE-METADATA] Retrying in 3s...`)
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
      }
    }
    
    if (!metadata || (!metadata.templateType && !metadata.purpose)) {
      throw new Error(`Failed to extract template metadata after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`)
    }
    
    console.log(`[TEMPLATE-METADATA] Analysis complete for ${templateSlug}:`, {
      type: metadata.templateType,
      complexity: metadata.complexity,
      requiredDataTypes: metadata.requiredDataTypes?.length
    })
    
    await saveTemplateMetadata(metadata)
    
    console.log(`[TEMPLATE-METADATA] Metadata saved to database for ${templateSlug}`)
    
    // Give SQLite a moment to commit
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Notify: success
    addTemplateNotification({
      templateSlug,
      status: 'complete',
      message: `Template metadata extracted successfully for ${templateName}`,
      metadata: {
        templateType: metadata.templateType,
        complexity: metadata.complexity,
        requiredDataTypesCount: metadata.requiredDataTypes?.length || 0,
        expectedEntitiesCount: metadata.expectedEntities?.length || 0
      },
      timestamp: Date.now()
    })
  } catch (err) {
    console.error(`[TEMPLATE-METADATA] Background extraction failed for ${templateSlug}:`, err)
    
    // Notify: error
    addTemplateNotification({
      templateSlug,
      status: 'error',
      message: `Failed to extract template metadata: ${(err as Error).message}`,
      timestamp: Date.now()
    })
    
    throw err
  }
}


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
    const xlsxPath = path.join(dir, 'template.xlsx')
    const srcName = (fs.readdirSync(dir).find((n) => /^source\./i.test(n)) || '')
    const srcPath = srcName ? path.join(dir, srcName) : ''
    const tmplHbsPath = path.join(dir, 'template.hbs')
    const suggestedPath = path.join(dir, 'template.suggested.hbs')

    // For DOCX/XLSX files, serve the raw file for download/opening
    // Frontend will handle preview via Electron or external viewer
    if (fs.existsSync(docxPath)) {
      const relPath = path.relative(process.cwd(), docxPath).replace(/\\/g, '/');
      return res.json({ 
        type: 'binary',
        format: 'docx', 
        path: docxPath,
        downloadUrl: `/api/templates/${encodeURIComponent(slug)}/download/docx`,
        source: 'template.docx' 
      })
    }
    
    if (fs.existsSync(xlsxPath)) {
      const relPath = path.relative(process.cwd(), xlsxPath).replace(/\\/g, '/');
      return res.json({ 
        type: 'binary',
        format: 'xlsx', 
        path: xlsxPath,
        downloadUrl: `/api/templates/${encodeURIComponent(slug)}/download/xlsx`,
        source: 'template.xlsx' 
      })
    }

    // For text-based templates
    if (srcPath) {
      const text = fs.readFileSync(srcPath, 'utf-8')
      return res.json({ text, source: path.basename(srcPath) })
    }
    
    if (fs.existsSync(tmplHbsPath)) {
      const text = fs.readFileSync(tmplHbsPath, 'utf-8')
      return res.json({ text, source: 'template.hbs' })
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
    
    return res.status(404).json({ error: 'No preview available' })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// Serve template files for download
router.get("/:slug/download/:fileType", async (req, res) => {
  const slug = String(req.params.slug);
  const fileType = String(req.params.fileType);
  try {
    const dir = path.join(TEMPLATES_ROOT, slug);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' });

    let filePath: string;
    let contentType: string;
    let fileName: string;

    if (fileType === 'docx') {
      filePath = path.join(dir, 'template.docx');
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      fileName = `${slug}-template.docx`;
    } else if (fileType === 'xlsx') {
      filePath = path.join(dir, 'template.xlsx');
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      fileName = `${slug}-template.xlsx`;
    } else {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

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
        const wsName = `Template_${name}` || `Template_${providedSlug}`
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

      // Trigger background metadata extraction (don't block response)
      if (wsSlug) {
        setImmediate(() => {
          extractTemplateMetadataInBackground(providedSlug, name, target, wsSlug!)
            .catch(err => console.error('[TEMPLATE-METADATA-BG] Failed:', err))
        })
      }

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
    let documentAnalysis = ''
    try {
      const docxPath = path.join(dir, 'template.docx')
      if (fs.existsSync(docxPath)) {
        const buffer = fs.readFileSync(docxPath)
        
        // Use intelligent document analysis for compilation
        try {
          documentAnalysis = await analyzeDocumentIntelligently(
            docxPath,
            String(slug),
            wsSlug,
            'compilation'
          )
        } catch {
          // Analysis is optional, continue without it
        }
        
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

    // Template compilation is agnostic - no customer data needed
    // The generator code will query customer workspaces at generation time

    const prompt = `You are a senior TypeScript engineer. Analyze this TEMPLATE and generate generator code that preserves ALL formatting/structure while enabling dynamic data replacement.

**CRITICAL: You are analyzing a TEMPLATE only. Do NOT assume what data will be available. Write GENERIC code that can query ANY customer workspace.**

OUTPUT: ONLY TypeScript code that returns raw WordprocessingML (WML).

EXPORT SIGNATURE (exact):
export async function generate(
  toolkit: { 
    json: (prompt: string) => Promise<any>; 
    text: (prompt: string) => Promise<string>; 
    query?: (prompt: string) => Promise<any>; 
    getSkeleton?: (kind?: 'html'|'text') => Promise<string> 
  },
  builder: any,
  context?: Record<string, any>
): Promise<{ wml: string }>;

YOUR JOB: Separate TEMPLATE STRUCTURE from PLACEHOLDER DATA

1. PRESERVE EXACTLY (from template):
   - ALL formatting: fonts, colors, sizes, spacing, alignment, borders
   - Document structure: headers, footers, sections, page layout
   - Styles: numbering patterns, list styles, table formatting
   - Theme colors, paragraph properties, run properties

2. IDENTIFY PLACEHOLDERS (replace with toolkit queries):
   - Sample data values: "Widget A", "100", "$50.00", "John Doe", "2024-01-01"
   - Repeated sample rows in tables (Product 1, Product 2, Product 3)
   - List items that look like examples
   - Any text enclosed in brackets: [Name], {Date}, {{Variable}}
   - Generic text: "Sample Item", "Example", "TBD", "Lorem ipsum"

3. WRITE SMART QUERIES:
   For tables with sample data, use toolkit.json() to fetch array of objects.
   For single values, use toolkit.text() to get specific values.
   Always start with "Check workspace document index first, then..."

4. BUILD WML DYNAMICALLY:
   - Preserve template WML structure for headers/formatting
   - Loop through fetched data to generate content rows/paragraphs
   - Apply template formatting to generated content
   - Use <w:rPr> for text formatting, <w:pPr> for paragraph props

WML REQUIREMENTS:
- Return { wml: string } with <w:body> children only
- No <w:sectPr> or package-level parts
- Preserve ALL XML formatting from template
- Use STYLES, THEME, NUMBERING XML for accurate styling

STRICT RULES:
- NO external imports or file I/O
- Do NOT assume specific data exists
- Do NOT hardcode data values
- Do NOT invent content not in template
- If something could be data OR structure, keep as structure

${documentAnalysis}

TEMPLATE ARTIFACTS (HTML skeleton + XML excerpts):
${skeleton}`

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
    const steps = ['resolveTemplate','resolveWorkspace','readTemplate','extractSkeleton','buildMetadataContext','buildPrompt','aiRequest','writeGenerator']
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
    let documentStructure = ''
    let isExcel = false
    try {
      const xlsxPath = path.join(dir, 'template.xlsx')
      if (fs.existsSync(xlsxPath)) {
        isExcel = true
        const buffer = fs.readFileSync(xlsxPath)
        stepOk('readTemplate')
        stepStart('extractSkeleton')
        try {
          const zip = new PizZip(buffer)
          const workbookXml: string = zip.file('xl/workbook.xml')?.asText() || ''
          const relsXml: string = zip.file('xl/_rels/workbook.xml.rels')?.asText() || ''
          const sstXml: string = zip.file('xl/sharedStrings.xml')?.asText() || ''
          const stylesXml: string = zip.file('xl/styles.xml')?.asText() || ''
          const xmlUnesc = (s: string) => String(s || '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          const shared: string[] = []
          if (sstXml) {
            const siMatches = Array.from(sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g))
            for (const m of siMatches) {
              const inner = m[1] || ''
              const texts = Array.from(inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map(mm => xmlUnesc(mm[1] || ''))
              shared.push(texts.join(''))
            }
          }
          const relMap: Record<string, string> = {}
          for (const m of Array.from(relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*>/g))) {
            const id = m[1]
            let target = m[2]
            if (target && !/^xl\//.test(target)) target = `xl/${target.replace(/^\.\//,'')}`
            relMap[id] = target
          }
          const sheets: Array<{ name: string; rid?: string; target?: string }> = []
          for (const m of Array.from(workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*>/g))) {
            const name = xmlUnesc(m[1] || '')
            const rid = m[2]
            const target = relMap[rid]
            sheets.push({ name, rid, target })
          }
          const parts: string[] = []
          // Excel alignment map from styles.xml
          const xfAlign: Record<number, string | undefined> = {}
          try {
            if (stylesXml) {
              const xfsMatch = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)
              const inner = xfsMatch ? xfsMatch[1] : ''
              let idx = 0
              for (const xmAny of Array.from(inner.matchAll(/<xf[^>]*?(?:\salignment=\"([^\"]*)\")[^>]*?\/>|<xf[^>]*?>([\s\S]*?)<\/xf>/g))) {
                const xm = xmAny as unknown as RegExpMatchArray
                const inlineAlign = xm[1] as string | undefined
                const xin = xm[2] as string | undefined
                let align: string | undefined
                if (inlineAlign) {
                  const hm = inlineAlign.match(/horizontal=\"([^\"]+)\"/)
                  align = hm ? hm[1] : undefined
                } else if (xin) {
                  const am = xin.match(/<alignment[^>]*horizontal=\"([^\"]+)\"[^>]*\/>/)
                  align = am ? am[1] : undefined
                }
                xfAlign[idx++] = align
              }
            }
          } catch {}
          parts.push('EXCEL TEMPLATE SKELETON:')
          parts.push('---')
          parts.push(`SHEETS (${sheets.length}): ${sheets.map((s,i)=>`${i+1}) ${s.name}`).join(' | ')}`)
          const maxSheets = Math.min(3, sheets.length || 0)
          for (let i=0; i<maxSheets; i++) {
            const s = sheets[i]!
            const target = s.target || ''
            let sheetXml = ''
            try { sheetXml = target ? (zip.file(target)?.asText() || '') : '' } catch {}
            parts.push('---')
            parts.push(`SHEET: ${s.name}`)
            // Column widths summary (first 12)
            try {
              const colsMatch = sheetXml.match(/<cols>([\s\S]*?)<\/cols>/)
              if (colsMatch) {
                const colWidths: Record<number, number> = {}
                const colsInner = colsMatch[1] || ''
                for (const cm of Array.from(colsInner.matchAll(/<col[^>]*min=\"(\d+)\"[^>]*max=\"(\d+)\"[^>]*width=\"([\d\.]+)\"[^>]*\/>/g))) {
                  const min = Number(cm[1]); const max = Number(cm[2]); const w = Number(cm[3])
                  for (let cc = min; cc <= max; cc++) colWidths[cc] = w
                }
                const firstCols = Object.keys(colWidths).map(n=>Number(n)).sort((a,b)=>a-b).slice(0,12)
                if (firstCols.length) {
                  const toCol = (n:number) => { let s=''; let x=n; while (x>0) { const m=((x-1)%26); s=String.fromCharCode(65+m)+s; x=Math.floor((x-1)/26) } return s }
                  parts.push(`COLUMNS (width): ${firstCols.map(c=>`${toCol(c)}=${(colWidths[c]||0).toFixed(2)}`).join(', ')}`)
                }
              }
            } catch {}
            const merges: string[] = []
            for (const mm of Array.from(sheetXml.matchAll(/<mergeCell[^>]*ref="([^"]+)"[^>]*\/>/g))) merges.push(mm[1])
            if (merges.length) parts.push(`MERGES: ${merges.slice(0,12).join(', ')}${merges.length>12?' …':''}`)
            const rowMatches = Array.from(sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g))
            const previewLines: string[] = []
            const alignmentSamples: string[] = []
            for (const rm of rowMatches) {
              const rnum = Number(rm[1])
              if (rnum > 50) break
              const rowXml = rm[2] || ''
              const cells = Array.from(rowXml.matchAll(/<c[^>]*r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g))
              const entries: string[] = []
              for (const c of cells) {
                const ref = c[1]
                const attrs = c[2] || ''
                const inner = c[3] || ''
                const tMatch = attrs.match(/\bt="([^"]+)"/)
                const t = tMatch ? tMatch[1] : undefined
                const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/)
                let vRaw = vMatch ? vMatch[1] : ''
                let val: string = ''
                if (t === 's') {
                  const idx = Number(vRaw)
                  val = String(shared[idx] ?? '')
                } else {
                  val = xmlUnesc(vRaw)
                }
                if (val && val.trim()) entries.push(`${ref}=${val.replace(/\s+/g,' ').slice(0,60)}`)
                // Sample a few alignments via style index s="n"
                const sIdxMatch = attrs.match(/\bs=\"(\d+)\"/)
                const sIdx = sIdxMatch ? Number(sIdxMatch[1]) : undefined
                const horiz = (sIdx != null) ? (xfAlign[sIdx] || undefined) : undefined
                if (horiz && alignmentSamples.length < 16) alignmentSamples.push(`${ref}=${horiz}`)
              }
              if (entries.length) previewLines.push(`R${rnum}: ${entries.join(' | ')}`)
              if (previewLines.length >= 12) break
            }
            if (previewLines.length) { parts.push('ROWS:', ...previewLines) }
            if (alignmentSamples.length) { parts.push(`ALIGNMENT SAMPLES: ${alignmentSamples.join(', ')}`) }
          }
          skeleton = parts.join('\n')
        } catch { skeleton = '' }
        stepOk('extractSkeleton')
      } else {
        const docxPath = path.join(dir, 'template.docx')
        if (fs.existsSync(docxPath)) {
          const buffer = fs.readFileSync(docxPath)
          stepOk('readTemplate')
          stepStart('extractSkeleton')
          
          // Use intelligent document analysis for compilation
          try {
            documentStructure = await analyzeDocumentIntelligently(
              docxPath,
              String(slug),
              String(wsSlug),
              'compilation'
            )
          } catch {
            // Analysis is optional, continue without it
          }
          
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
      }
    } catch { /* ignore; skeleton may be empty */ }

    // Build metadata-enhanced context
    stepStart('buildMetadataContext')
    logPush('Building metadata-enhanced context...')
    let metadataContext = ''
    try {
      // Note: Compilation doesn't have a specific customerId (it's template-only operation)
      // Pass 0 as customerId to signal workspace-only mode in metadata matching
      logPush('[METADATA] Analyzing template requirements and available documents')
      const enhancedCtx = await buildMetadataEnhancedContext(slug, 0, wsSlug)
      metadataContext = enhancedCtx.promptEnhancement + enhancedCtx.documentSummaries
      
      if (enhancedCtx.templateMetadata) {
        const meta = enhancedCtx.templateMetadata
        if (meta.requiredDataTypes?.length) {
          logPush(`[METADATA] Template expects data types: ${meta.requiredDataTypes.join(', ')}`)
        }
        if (meta.expectedEntities?.length) {
          logPush(`[METADATA] Expected entities: ${meta.expectedEntities.join(', ')}`)
        }
        if (meta.purpose) {
          logPush(`[METADATA] Template purpose: ${meta.purpose.substring(0, 100)}${meta.purpose.length > 100 ? '...' : ''}`)
        }
      }
      
      if (enhancedCtx.relevantDocuments?.length) {
        logPush(`[METADATA] Found ${enhancedCtx.relevantDocuments.length} relevant workspace document(s)`)
        enhancedCtx.relevantDocuments.slice(0, 5).forEach((doc, idx) => {
          const score = doc.relevanceScore ?? 0
          logPush(`[METADATA]   ${idx + 1}. ${doc.filename} (relevance: ${score}/10)`)
        })
      } else {
        logPush('[METADATA] No relevant documents found in workspace')
      }
      
      logPush(`[METADATA] Context enhancement complete (${metadataContext.length} chars)`)
      stepOk('buildMetadataContext')
    } catch (err: any) {
      logPush(`[METADATA] Context unavailable: ${err.message}`)
      stepOk('buildMetadataContext') // Don't fail compilation if metadata unavailable
    }

    // Build prompt
    stepStart('buildPrompt')
    logPush(`Building ${isExcel ? 'Excel' : 'DOCX'} compilation prompt...`)
    const prompt = isExcel
        ? `You are a senior TypeScript engineer. Analyze this Excel TEMPLATE and generate code that preserves ALL formatting while enabling dynamic data population.

**CRITICAL: You are analyzing a TEMPLATE only. Do NOT assume what data will be available. Write GENERIC code that can query ANY customer workspace.**

OUTPUT: ONLY TypeScript code.

EXPORT SIGNATURE (exact):
export async function generate(
  toolkit: { 
    json: (prompt: string) => Promise<any>; 
    text: (prompt: string) => Promise<string>; 
    query?: (prompt: string) => Promise<any>; 
    getSkeleton?: (kind?: 'text') => Promise<string> 
  },
  builder: any,
  context?: Record<string, any>
): Promise<{ sheets: Array<{ name: string; insertRows?: Array<{ at: number; count: number; copyStyleFromRow?: number }>; cells?: Array<{ ref: string; v: string|number|boolean; numFmt?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; bg?: string; align?: 'left'|'center'|'right'; wrap?: boolean }>; ranges?: Array<{ start: string; values: any[][]; numFmt?: string }> }> }>;

YOUR JOB: Separate TEMPLATE STRUCTURE from PLACEHOLDER DATA

1. PRESERVE EXACTLY (from template):
   - Sheet names, order, structure
   - Header rows, column headers
   - ALL formatting: fonts, colors, fills, borders, number formats, alignment
   - Merged cells, column widths, row heights

2. IDENTIFY PLACEHOLDERS (replace with toolkit queries):
   - Sample data rows (Product 1, Product 2, Item A, Item B)
   - Generic values: "Sample", "Example", "TBD", dummy numbers
   - Repeated patterns suggesting variable-length data

3. WRITE SMART QUERIES:
   For data to populate rows, use toolkit.json() to fetch array of objects.
   Always start with "Check workspace document index first, then..."
   Match field names to column headers from the template.

4. POPULATE DYNAMICALLY:
   - Use insertRows with copyStyleFromRow to preserve formatting
   - Use 'ranges' array for efficiency (2D array of values)
   - Preserve header row exactly as-is
   - Start data population below headers

EXCEL REQUIREMENTS:
- If template has one sheet: Use that sheet as the structure template
- If data naturally groups by category/type: CREATE additional sheets dynamically
- Each sheet should follow the structure/formatting of the template sheet
- Use A1 references for individual cells
- Use ranges for bulk data population
- Preserve formatting from template for all sheets

MULTI-SHEET INTELLIGENCE:
- Analyze the data requirements and user instructions
- If instructions mention "separate sheets", "by category", "by type", etc., create multiple sheets
- If data has natural groupings (e.g., different applications, departments, products), create separate sheets
- Name new sheets descriptively based on the data grouping
- Each new sheet should replicate the template's header row and formatting
- Example: Template has "Test Cases" sheet → Generate sheets if data groups by application

STRICT RULES:
- NO external imports or file I/O
- Do NOT assume specific data exists
- Do NOT hardcode data values
- CREATE new sheets when data logically groups into categories

EXCEL TEMPLATE ARTIFACTS (merges, widths, alignment):
${skeleton}`
        : `You are a senior TypeScript engineer and document automation specialist. Analyze this template and generate INTELLIGENT generator code that separates STRUCTURE from DATA.

OUTPUT: ONLY TypeScript code that returns raw WordprocessingML (WML).

EXPORT SIGNATURE (exact):
export async function generate(
  toolkit: { 
    json: (prompt: string) => Promise<any>; 
    text: (prompt: string) => Promise<string>; 
    query?: (prompt: string) => Promise<any>; 
    getSkeleton?: (kind?: 'html'|'text') => Promise<string> 
  },
  builder: any,
  context?: Record<string, any>
): Promise<{ wml: string }>;

CRITICAL: HYBRID DYNAMIC APPROACH
1. STATIC PART (preserve from template):
   - Document structure (sections, paragraphs, tables, lists)
   - All formatting (fonts, colors, sizes, spacing, alignment)
   - Headers, footers, page layout
   - Numbering patterns, list styles
   - Table borders, cell formatting
   - Theme colors and styles

2. DYNAMIC PART (fetch at runtime via toolkit):
   - Variable text content (names, dates, values)
   - Table rows with data
   - List items from data sources
   - Any content that looks like placeholder/sample data
   
HOW TO IDENTIFY DATA vs STRUCTURE:
- STRUCTURE: "Inventory Report", "Total:", "Item", "Quantity", "Price" (headers/labels)
- DATA: "Widget A", "100", "$50.00", "Product 1", "Sample Item" (actual values)
- If template has sample rows/items, REPLACE with toolkit.json() query
- If template has placeholders like [Name], {Date}, replace with dynamic fetch

TOOLKIT USAGE:
- toolkit.json() returns structured data as JSON array/object
- ALWAYS start queries with: "First check workspace document index, then..."
- Reference specific documents from metadata context
- Example: const data = await toolkit.json('First check workspace document index. Then from the most relevant spreadsheet, return all rows as JSON array with columns: Item, Quantity, Price')

WML REQUIREMENTS:
- Return ONLY { wml } containing inner <w:body> children (<w:p>, <w:tbl>, ...)
- Do NOT include <w:sectPr> or package-level parts
- Mirror template structure exactly for static elements
- Use run properties: <w:rPr> for color/size/bold/italic/underline/strike/font
- Use paragraph properties: <w:pPr> for alignment/spacing/indents
- Use table properties: <w:tblPr> for widths/borders/styles
- Use <w:numPr> for list numbering matching template
- Preserve ALL styling from STYLES, THEME, NUMBERING XML
- Convert theme colors to hex where needed

STRICT CONSTRAINTS:
- Do NOT output HTML, Markdown, or DOCX buffer
- No external imports or file I/O
- Do NOT add content not in template skeleton
- Do NOT change fonts/colors/spacing unless expanding data
- If unsure whether something is data or structure, treat as structure
- For tables: preserve header row formatting, replicate data rows
- For lists: preserve numbering format, populate items from data

${documentStructure}

${metadataContext}

TEMPLATE ARTIFACTS (HTML skeleton + XML excerpts):
${skeleton}`
    logPush(`Prompt built (${prompt.length} chars, ${skeleton.length} chars skeleton, ${metadataContext.length} chars metadata)`)
    stepOk('buildPrompt')

    // AI request
    stepStart('aiRequest')
    logPush(`Sending compilation request to workspace: ${wsSlug}`)
    try {
      if (isCancelled(job.id)) { jobLog(job.id, 'cancelled'); send({ type: 'error', error: 'cancelled' }); return res.end() }
      const chat = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(wsSlug))}/chat`, 'POST', { message: prompt, mode: 'query' })
      const text = String(chat?.textResponse || chat?.message || chat || '')
      logPush(`AI response received (${text.length} chars)`)
      let code = text
      const m = text.match(/```[a-z]*\s*([\s\S]*?)```/i)
      if (m && m[1]) {
        code = m[1]
        logPush('Extracted code from markdown fence blocks')
      }
      code = code.trim()
      logPush(`Generator code ready (${code.length} chars)`)
      stepOk('aiRequest')

      // Write generator
      stepStart('writeGenerator')
      if (!code) { 
        logPush('ERROR: No code returned from AI')
        send({ type: 'error', error: 'No code returned' }); 
        return res.end() 
      }
      const genPath = path.join(dir,'generator.full.ts')
      fs.writeFileSync(genPath, code, 'utf-8')
      logPush(`Generator written to: generator.full.ts`)
      stepOk('writeGenerator')
      markJobDone(job.id, { path: genPath, name: 'generator.full.ts' }, { usedWorkspace: wsSlug })
      logPush('Compilation complete')
      return send({ type: 'done', file: { path: genPath, name: 'generator.full.ts' }, usedWorkspace: wsSlug, jobId: job.id })
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
    
    // Delete template metadata from database
    try {
      await deleteTemplateMetadata(slug)
    } catch (err) {
      console.error('[TEMPLATE-DELETE] Failed to delete metadata:', err)
      // Non-fatal, continue
    }
    
    return res.json({ ok: true, deleted: slug, ...(workspaceSlug ? { workspaceSlug } : {}), workspaceDeleted })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// ---- Template Metadata Endpoints ----

// GET /api/templates/:slug/metadata -> get template metadata
router.get("/:slug/metadata", async (req, res) => {
  const slug = String(req.params.slug)
  try {
    const metadata = await loadTemplateMetadata(slug)
    if (!metadata) {
      return res.status(404).json({ error: "Metadata not found" })
    }
    return res.json({ metadata })
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message })
  }
})

// POST /api/templates/:slug/metadata-extract -> manually trigger metadata extraction
router.post("/:slug/metadata-extract", async (req, res) => {
  const slug = String(req.params.slug)
  
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) {
      return res.status(404).json({ error: "Template not found" })
    }
    
    // Load template metadata
    const metaPath = path.join(dir, 'template.json')
    let meta: any = {}
    let wsSlug: string | undefined
    try {
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        wsSlug = meta?.workspaceSlug
      }
    } catch {}
    
    if (!wsSlug) {
      return res.status(400).json({ error: "Template has no workspace configured" })
    }
    
    const name = meta?.name || slug
    
    // Find template file
    const docxPath = path.join(dir, 'template.docx')
    const xlsxPath = path.join(dir, 'template.xlsx')
    const templatePath = fs.existsSync(docxPath) ? docxPath : (fs.existsSync(xlsxPath) ? xlsxPath : '')
    
    if (!templatePath) {
      return res.status(404).json({ error: "Template file not found" })
    }
    
    // Return immediately and process in background
    res.json({ ok: true, message: "Template metadata extraction started" })
    
    // Start background extraction
    setImmediate(() => {
      extractTemplateMetadataInBackground(slug, name, templatePath, wsSlug!)
        .catch(err => console.error('[TEMPLATE-METADATA-RETRY] Failed:', err))
    })
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/templates/metadata/notifications -> get recent template metadata notifications
router.get("/metadata/notifications", (_req, res) => {
  return res.json({ notifications: templateMetadataNotifications.slice(0, 20) })
})

// GET /api/templates/metadata/stream -> Server-Sent Events stream for real-time notifications
router.get("/metadata/stream", (req, res) => {
  // Optional: slug to track specifically
  const trackSlug = req.query.slug ? String(req.query.slug) : null
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
  
  // If tracking a specific template, send any recent notification for it (within last 5 seconds)
  if (trackSlug) {
    const fiveSecondsAgo = Date.now() - 5000
    const recentNotification = templateMetadataNotifications
      .filter(n => n.templateSlug === trackSlug && n.timestamp > fiveSecondsAgo)
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    
    if (recentNotification) {
      console.log(`[TEMPLATE-SSE] Sending recent notification for tracked template: ${trackSlug}`)
      res.write(`data: ${JSON.stringify({ type: 'notification', notification: recentNotification })}\n\n`)
    }
  }
  
  // Set lastCheck to NOW so we only get NEW notifications from this point forward
  let lastCheck = Date.now()
  console.log(`[TEMPLATE-SSE] New connection, lastCheck set to ${lastCheck}`, trackSlug ? `tracking: ${trackSlug}` : '')
  
  // Check for new notifications every 2 seconds
  const interval = setInterval(() => {
    const newNotifications = templateMetadataNotifications
      .filter(n => n.timestamp > lastCheck)
    
    if (newNotifications.length > 0) {
      console.log(`[TEMPLATE-SSE] Sending ${newNotifications.length} notifications`)
      newNotifications.forEach(notification => {
        console.log(`[TEMPLATE-SSE] Notification: ${notification.templateSlug} - ${notification.status}`)
        res.write(`data: ${JSON.stringify({ type: 'notification', notification })}\n\n`)
      })
      lastCheck = Date.now()
    }
  }, 2000)
  
  // Cleanup on client disconnect
  req.on('close', () => {
    console.log(`[TEMPLATE-SSE] Connection closed`)
    clearInterval(interval)
    res.end()
  })
})

// GET /api/templates/metadata/all -> get all template metadata
router.get("/metadata/all", async (_req, res) => {
  try {
    const allMetadata = await loadAllTemplateMetadata()
    return res.json({ templates: allMetadata })
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message })
  }
})

// Versioning routes removed; single upload endpoint above handles both new and replacement uploads without version history.
