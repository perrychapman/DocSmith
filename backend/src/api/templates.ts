// backend/src/api/templates.ts
import { Router } from "express"
import fs from "fs"
import path from "path"
import { loadTemplate } from "../services/templateEngine"
import { safeSlug } from "../services/fs"
import { anythingllmRequest } from "../services/anythingllm"
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
          return { slug, name: name || slug, hasTemplate: (hasHbs || hasDocx), hasSource, hasScript, hasHelperTs, hasFullGen, compiledAt, workspaceSlug, updatedAt }
        } catch {
          return { slug: d.name, name: d.name, hasTemplate: false, hasSource: false, hasScript: false, hasHelperTs: false, hasFullGen: false, updatedAt: new Date().toISOString() }
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
  const slug = String(req.params.slug)
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found' })
    const metaPath = path.join(dir, 'template.json')
    let wsSlug: string | undefined
    try { const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); if (meta?.workspaceSlug) wsSlug = String(meta.workspaceSlug) } catch {}
    if (!wsSlug) return res.status(400).json({ error: 'No workspace associated with this template' })

    // Extract a readable structure skeleton from template (prefer HTML to preserve structure)
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

          // Append hints to skeleton for the prompt assembly below
          const parts: string[] = []
          parts.push('TEMPLATE SKELETON (HTML excerpt):')
          parts.push('---')
          parts.push(skeleton.slice(0, 12000))
          parts.push('---')
          if (stylesHint) { parts.push('STYLES XML (excerpt):', '---', stylesHint, '---') }
          if (stylesFxHint) { parts.push('STYLES WITH EFFECTS XML (excerpt):', '---', stylesFxHint, '---') }
          if (numberingHint) { parts.push('NUMBERING XML (excerpt):', '---', numberingHint, '---') }
          if (documentHint) { parts.push('DOCUMENT XML (excerpt):', '---', documentHint, '---') }
          if (themeHint) { parts.push('THEME XML (excerpt):', '---', themeHint, '---') }
          if (headersHint) { parts.push('HEADERS XML (excerpt):', '---', headersHint, '---') }
          if (footersHint) { parts.push('FOOTERS XML (excerpt):', '---', footersHint, '---') }
          skeleton = parts.join('\n')
        } catch {}
      } else {
        const srcName = (fs.readdirSync(dir).find((n) => /^source\./i.test(n)) || '')
        if (srcName) skeleton = fs.readFileSync(path.join(dir, srcName), 'utf-8')
        else if (fs.existsSync(path.join(dir, 'template.hbs'))) skeleton = fs.readFileSync(path.join(dir, 'template.hbs'), 'utf-8')
      }
    } catch {}

    const prompt = `You are a senior TypeScript engineer and document automation specialist. Recreate this template as faithfully as possible while preserving layout, section order, branding, headers/footers, spacing, lists, tables, and emphasis.\n\nOutput: ONLY TypeScript code.\n\nExport exactly:\nexport async function generate(\n  toolkit: { json: (prompt: string) => Promise<any>; text: (prompt: string) => Promise<string>; query?: (prompt: string) => Promise<any>; getSkeleton?: (kind?: 'html'|'text') => Promise<string>; markdownToHtml: (md: string) => string; htmlToDocx: (html: string) => Promise<Uint8Array> },\n  builder: { addHeading(text: string, level?: 1|2|3|4|5|6, opts?: any): void; addParagraph(text: string, opts?: any): void; addBulletList(items: string[]): void; addNumberedList(items: string[]): void; addTable(rows: string[][]): void; pageBreak(): void; save(): Promise<Uint8Array> },\n  context?: Record<string, any>\n): Promise<{ docx?: Uint8Array; html?: string; markdown?: string } | void>;\n\nStrict requirements:\n- Minimize LLM calls: batch any data needs into ONE call (toolkit.query or toolkit.json) if needed.\n- Mirror the TEMPLATE SKELETON or toolkit.getSkeleton('html') to match headings, ordering, and grouping.\n- Prefer the builder API for formatting: use heading levels, paragraph opts (alignment, bold/italic), bullet/numbered lists, tables, and page breaks for clear section boundaries.\n- Apply default paragraph/run styles (font family/size/weight/italic) according to STYLES XML hints when composing content.\n- Preserve visible branding blocks and disclaimers. If exact headers/footers are not available, replicate their content near top/bottom of each logical page (use pageBreak).\n- Honor list formats from NUMBERING XML (e.g., decimal vs bullet), and keep indentation consistent.\n- Recreate spacing and blank lines for visual parity; keep line breaks consistent.\n- No external imports or file I/O.\n\nReturn strategy:\n- If you confidently reconstruct using builder, return { docx }.\n- If exact styles require HTML, compose faithful HTML and return { html } (DocSmith converts via toolkit.htmlToDocx).\n\nTEMPLATE ARTIFACTS (excerpts follow; HTML skeleton and XML hints may be present).\n${skeleton}`

    const chat = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(wsSlug))}/chat`, 'POST', { message: prompt, mode: 'query' })
    const text = String(chat?.textResponse || chat?.message || chat || '')
    let code = text
    const m = text.match(/```[a-z]*\s*([\s\S]*?)```/i)
    if (m && m[1]) code = m[1]
    code = code.trim()
    if (!code) return res.status(502).json({ error: 'No code returned' })
    fs.writeFileSync(path.join(dir, 'generator.full.ts'), code, 'utf-8')
    return res.json({ ok: true })
  } catch (e) { return res.status(500).json({ error: (e as Error).message }) }
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
      const target = path.join(dir, isDocx ? `template.docx` : `source${ext}`)
      fs.renameSync(f.path, target)
      // Write/merge template.json
      const metaPath = path.join(dir, 'template.json')
      let meta: any = {}
      try { if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath,'utf-8')) } catch {}
      const name = String((req.body?.name || meta?.name || providedSlug)).trim()
      const fmt = isDocx ? 'docx' : (ext === '.html' ? 'html' : (ext === '.md' || ext === '.markdown' ? 'md' : 'txt'))
      meta = { ...meta, name, output: { format: fmt, filenamePattern: (meta?.output?.filenamePattern || `${providedSlug}-{{ts}}`) } }
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

    const prompt = `You are a senior TypeScript engineer and document automation specialist. Recreate this template as faithfully as possible while preserving layout, section order, branding, headers/footers, spacing, lists, tables, and emphasis.\n\nOutput: ONLY TypeScript code.\n\nExport exactly:\nexport async function generate(\n  toolkit: { json: (prompt: string) => Promise<any>; text: (prompt: string) => Promise<string>; query?: (prompt: string) => Promise<any>; getSkeleton?: (kind?: 'html'|'text') => Promise<string>; markdownToHtml: (md: string) => string; htmlToDocx: (html: string) => Promise<Uint8Array> },\n  builder: { addHeading(text: string, level?: 1|2|3|4|5|6, opts?: any): void; addParagraph(text: string, opts?: any): void; addBulletList(items: string[]): void; addNumberedList(items: string[]): void; addTable(rows: string[][]): void; pageBreak(): void; save(): Promise<Uint8Array> },\n  context?: Record<string, any>\n): Promise<{ docx?: Uint8Array; html?: string; markdown?: string } | void>;\n\nStrict requirements:\n- Minimize LLM calls: batch any data needs into ONE call (toolkit.query or toolkit.json) if needed.\n- Mirror the TEMPLATE SKELETON or toolkit.getSkeleton('html') to match headings, ordering, and grouping.\n- Prefer the builder API for formatting: use heading levels, paragraph opts (alignment, bold/italic), bullet/numbered lists, tables, and page breaks for clear section boundaries.\n- Preserve visible branding blocks and disclaimers. If exact headers/footers are not available, replicate their content near top/bottom of each logical page (use pageBreak).\n- Recreate spacing and blank lines for visual parity; keep line breaks consistent.\n- No external imports or file I/O.\n\nReturn strategy:\n- If you confidently reconstruct using builder, return { docx }.\n- If exact styles require HTML, compose faithful HTML and return { html } (DocSmith converts via toolkit.htmlToDocx).\n\nTEMPLATE SKELETON (HTML or text excerpt):\n---\n${skeleton.slice(0,12000)}\n---`

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
