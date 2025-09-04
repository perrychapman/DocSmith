import fs from "fs"
import path from "path"

// Lazy import handlebars to avoid type requirements at compile time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Handlebars = require("handlebars")

export type LoadedTemplate =
  | { kind: 'hbs'; slug: string; dir: string; compiled: any; meta: TemplateMeta }
  | { kind: 'docx'; slug: string; dir: string; templatePath: string; meta: TemplateMeta }

export type TemplateMeta = {
  name?: string
  schema?: { fields?: Array<{ key: string; label?: string; type?: string; hint?: string }> }
  output?: { format?: "md" | "html" | "txt" | "docx"; filenamePattern?: string }
  // New: support dynamic compilation outputs
  dynamic?: {
    mode?: "dynamic" | "strict"
    // High-level plan of how to fill data from a workspace (best-effort, optional)
    plan?: Array<{
      key: string
      description?: string
      strategy?: "list" | "single"
      prompt?: string
      schema?: any
    }>
    partials?: Record<string, string>
    notes?: string
  }
}

export function loadTemplate(slug: string, baseDir: string): LoadedTemplate | null {
  const dir = path.join(baseDir, slug)
  const hbs = path.join(dir, "template.hbs")
  const docx = path.join(dir, "template.docx")
  const metaPath = path.join(dir, "template.json")
  let meta: TemplateMeta = {}
  try { if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) } catch {}
  if (fs.existsSync(hbs)) {
    const source = fs.readFileSync(hbs, "utf-8")
    const compiled = Handlebars.compile(source)
    return { kind: 'hbs', slug, dir, compiled, meta }
  }
  if (fs.existsSync(docx)) {
    return { kind: 'docx', slug, dir, templatePath: docx, meta }
  }
  return null
}

export function renderTemplate(compiled: any, data: any) {
  return compiled(data)
}
