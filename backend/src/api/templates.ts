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
const multer = require("multer")

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
        const slug = d.name
        const hasHbs = fs.existsSync(path.join(TEMPLATES_ROOT, slug, "template.hbs"))
        const hasDocx = fs.existsSync(path.join(TEMPLATES_ROOT, slug, "template.docx"))
        const hasSource = !!(fs.readdirSync(path.join(TEMPLATES_ROOT, slug)).find((n) => /^source\./i.test(n)))
        const stat = fs.statSync(path.join(TEMPLATES_ROOT, slug))
        let name: string | undefined
        try {
          const metaPath = path.join(TEMPLATES_ROOT, slug, "template.json")
          if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
            name = meta?.name
          }
        } catch {}
        return { slug, name: name || slug, hasTemplate: (hasHbs || hasDocx), hasSource, updatedAt: stat.mtime.toISOString() }
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

export default router

// ---- Upload a raw template source (markdown/html/txt) ----
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
    // We save as source.<ext> inside the slug directory; but multer needs a leaf filename
    // We'll write to a temp then move in finalize step
    cb(null, `${providedSlug}__upload${ext}`)
  }
})
const upload = multer({ storage })

router.post("/upload", (req, res) => {
  upload.single("file")(req as any, res as any, (err: any) => {
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
      // Write initial template.json if missing
      const metaPath = path.join(dir, "template.json")
      if (!fs.existsSync(metaPath)) {
        const name = String((req.body?.name || providedSlug)).trim()
        const fmt = ext === ".html" ? "html" : (ext === ".md" || ext === ".markdown" ? "md" : (ext === ".docx" ? "docx" : "txt"))
        fs.writeFileSync(metaPath, JSON.stringify({ name, output: { format: fmt, filenamePattern: `${providedSlug}-{{ts}}` }, schema: { fields: [] } }, null, 2), "utf-8")
      }
      return res.status(201).json({ ok: true, slug: providedSlug })
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
    if (!fs.existsSync(dir)) return res.status(404).json({ error: "Template not found" })
    const sourceFile = (fs.readdirSync(dir).find((n) => /^source\./i.test(n)) || "")
    if (!sourceFile) {
      // If already compiled (hbs) or a docx template exists, treat as no-op compile
      const hbsPath = path.join(dir, 'template.hbs')
      const docxPath = path.join(dir, 'template.docx')
      if (fs.existsSync(docxPath)) {
        const metaPath = path.join(dir, 'template.json')
        let meta: any = {}
        try { if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch {}
        meta = { name: meta?.name || slug, output: { format: 'docx', filenamePattern: (meta?.output?.filenamePattern || `${slug}-{{ts}}`) }, schema: meta?.schema || { fields: [] } }
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
        return res.json({ ok: true, slug, meta, info: 'docx template ready' })
      }
      if (fs.existsSync(hbsPath)) {
        // Already compiled; ensure meta exists
        const metaPath = path.join(dir, 'template.json')
        let meta: any = {}
        try { if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch {}
        if (!meta?.output?.format) {
          meta = { name: meta?.name || slug, output: { format: 'md', filenamePattern: (meta?.output?.filenamePattern || `${slug}-{{ts}}`) }, schema: meta?.schema || { fields: [] } }
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
        }
        return res.json({ ok: true, slug, meta, info: 'already compiled' })
      }
      return res.status(400).json({ error: "No source file found (expected source.*)" })
    }
    const ext = path.extname(sourceFile).toLowerCase()
    if (ext === ".docx") {
      // For DOCX, treat the uploaded file as the template; just ensure template.json exists with correct format
      const metaPath = path.join(dir, "template.json")
      let meta: any = {}
      try { if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) } catch {}
      meta = { name: meta?.name || slug, output: { format: 'docx', filenamePattern: (meta?.output?.filenamePattern || `${slug}-{{ts}}`) }, schema: meta?.schema || { fields: [] } }
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
      return res.json({ ok: true, slug, meta })
    }
    const source = fs.readFileSync(path.join(dir, sourceFile), "utf-8")

    // Resolve compiler workspace: from settings or ensure default "TemplateCompiler"
    const list = await anythingllmRequest<any>("/workspaces", "GET")
    const arr: Array<{ name?: string; slug?: string }> = Array.isArray((list as any)?.workspaces) ? (list as any).workspaces : (Array.isArray(list) ? (list as any) : [])
    let targetWs: string | undefined
    const settings = readSettings()
    if (settings?.templateCompilerWorkspaceSlug) {
      targetWs = arr.find((w) => w.slug === settings.templateCompilerWorkspaceSlug)?.slug
    }
    if (!targetWs) {
      // ensure a workspace named TemplateCompiler exists
      const existing = arr.find((w) => (w.name || "") === "TemplateCompiler")
      if (existing?.slug) {
        targetWs = existing.slug
        // persist slug if not set
        if (!settings?.templateCompilerWorkspaceSlug) writeSettings({ ...settings, templateCompilerWorkspaceSlug: targetWs })
      } else {
        const created = await anythingllmRequest<any>("/workspace/new", "POST", { name: "TemplateCompiler" })
        const slug = created?.workspace?.slug
        if (slug) {
          targetWs = slug
          writeSettings({ ...settings, templateCompilerWorkspaceSlug: slug })
        }
      }
    }
    if (!targetWs) return res.status(400).json({ error: "Failed to resolve or create TemplateCompiler workspace" })

    const instructions = `You are a professional document template compiler.
Given a raw document template or specification, extract a clean JSON schema of fields and produce a Handlebars template that uses those fields.
Respond ONLY with strict JSON in the following shape:
{
  "name": string,                // template human name
  "output": { "format": "md"|"html"|"txt" },
  "schema": { "fields": [ { "key": string, "label"?: string, "type"?: string, "hint"?: string } ] },
  "templateHbs": string          // handlebars template body
}
Do not include markdown fences, comments, or extra text. Keys must be exactly as above.`

    const prompt = `${instructions}\n\nSOURCE:\n\n\`\`\`\n${source}\n\`\`\``
    const chat = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(targetWs))}/chat`, "POST", { message: prompt, mode: "query" })
    const text = String(chat?.textResponse || chat?.message || chat || "")

    function tryParseJson(s: string): any {
      // direct parse
      try { return JSON.parse(s) } catch {}
      // extract outermost JSON object crudely
      const first = s.indexOf("{")
      const last = s.lastIndexOf("}")
      if (first >= 0 && last > first) {
        const slice = s.slice(first, last + 1)
        try { return JSON.parse(slice) } catch {}
      }
      // try code fence ```json ... ```
      const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
      if (m && m[1]) { try { return JSON.parse(m[1]) } catch {} }
      return null
    }

    const obj = tryParseJson(text)
    if (!obj || !obj.templateHbs) return res.status(502).json({ error: "Failed to parse compile result", raw: text })

    const meta = { name: obj.name || slug, output: obj.output || { format: ext === ".html" ? "html" : (ext === ".md" ? "md" : "txt") }, schema: obj.schema || { fields: [] } }
    fs.writeFileSync(path.join(dir, "template.hbs"), String(obj.templateHbs), "utf-8")
    fs.writeFileSync(path.join(dir, "template.json"), JSON.stringify(meta, null, 2), "utf-8")
    return res.json({ ok: true, slug, meta })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})

// ---- Delete a template folder ----
router.delete("/:slug", (req, res) => {
  const slug = String(req.params.slug || "").trim()
  if (!slug) return res.status(400).json({ error: "Missing slug" })
  try {
    const dir = path.join(TEMPLATES_ROOT, slug)
    const safeRoot = path.resolve(TEMPLATES_ROOT)
    const safeDir = path.resolve(dir)
    if (!safeDir.startsWith(safeRoot)) return res.status(400).json({ error: "Invalid path" })
    if (fs.existsSync(safeDir)) {
      fs.rmSync(safeDir, { recursive: true, force: true })
      return res.json({ ok: true, deleted: slug })
    }
    return res.status(404).json({ error: "Template not found" })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
})
