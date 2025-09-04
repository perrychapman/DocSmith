// backend/src/api/generate.ts
import { Router } from "express"
import fs from "fs"
import path from "path"
import { getDB } from "../services/storage"
import { renderTemplate, loadTemplate } from "../services/templateEngine"
import { mergeHtmlIntoDocxTemplate } from "../services/docxCompose"
import { ensureDocumentsDir, resolveCustomerPaths } from "../services/customerLibrary"
import { libraryRoot } from "../services/fs"
import { anythingllmRequest } from "../services/anythingllm"
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

const router = Router()

const TEMPLATES_ROOT = path.join(libraryRoot(), "templates")

type Body = { customerId?: number; template?: string; filename?: string; data?: any; embed?: boolean }

router.post("/", async (req, res) => {
  const { customerId, template: slug, filename, data, embed } = (req.body || {}) as Body
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

        // If a generator.ts or generator.script.json exists and template.json has a workspaceSlug, use it to enrich context
        let usedWorkspace: string | undefined
        let generatorUsed = false
        let helperUsed = false
        const logs: string[] = []
        try {
          const metaPath = path.join(tpl.dir, 'template.json')
          // Prefer customer's workspace over template's
          let wsSlug: string | undefined = row.workspaceSlug ? String(row.workspaceSlug) : undefined
          if (!wsSlug && fs.existsSync(metaPath)) {
            try { const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); if (meta?.workspaceSlug) wsSlug = String(meta.workspaceSlug) } catch {}
          }
          const helperPath = path.join(tpl.dir, 'generator.ts')
          const fullGenPath = path.join(tpl.dir, 'generator.full.ts')
          const docGenPath = path.join(tpl.dir, 'generator.doc.ts')
          const scriptPath = path.join(tpl.dir, 'generator.script.json')

          // Top preference: Full document generator (no placeholders)
          if (row.workspaceSlug && fs.existsSync(fullGenPath)) {
            try {
              usedWorkspace = row.workspaceSlug
              const tsCode = fs.readFileSync(fullGenPath, 'utf-8')
              const jsOut = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } })
              const sandbox: any = { module: { exports: {} }, exports: {}, console }
              vm.createContext(sandbox)
              const wrapped = `(function (module, exports) { ${jsOut.outputText}\n;return module.exports; })`
              const fn = vm.runInContext(wrapped, sandbox)
              const mod = fn(sandbox.module, sandbox.exports)
              const generateFull = mod?.generate
              if (typeof generateFull === 'function') {
                // Minimal DOCX builder API (no external imports in user code)
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
                } = docxLib
                const doc = new Document({ sections: [{ properties: {}, children: [] }] })
                const children: any[] = (doc as any).Sections[0].properties.children || (doc as any).sections?.[0]?.children || []
                const builderUsed = { used: false }
                const builder = {
                  addHeading: (text: string, level: 1|2|3|4|5|6 = 1, opts?: any) => {
                    builderUsed.used = true
                    const lvlMap: any = {1: HeadingLevel.HEADING_1,2: HeadingLevel.HEADING_2,3: HeadingLevel.HEADING_3,4: HeadingLevel.HEADING_4,5: HeadingLevel.HEADING_5,6: HeadingLevel.HEADING_6}
                    children.push(new Paragraph({ heading: lvlMap[level] || HeadingLevel.HEADING_1, children: [ new TextRun(String(text||'')) ] }))
                  },
                  addParagraph: (text: string, opts?: any) => {
                    builderUsed.used = true
                    children.push(new Paragraph({ children: [ new TextRun(String(text||'')) ] }))
                  },
                  addBulletList: (items: string[]) => {
                    builderUsed.used = true
                    for (const it of (items||[])) children.push(new Paragraph({ text: String(it||''), bullet: { level: 0 } }))
                  },
                  addNumberedList: (items: string[]) => {
                    builderUsed.used = true
                    for (const it of (items||[])) children.push(new Paragraph({ text: String(it||''), numbering: { reference: 'num-default', level: 0 } }))
                  },
                  addTable: (rows: Array<string[]>) => {
                    builderUsed.used = true
                    const tRows = (rows||[]).map(r => new TableRow({ children: (r||[]).map(c => new TableCell({ children: [ new Paragraph(String(c||'')) ] })) }))
                    children.push(new Table({ rows: tRows, width: { size: 100, type: WidthType.PERCENTAGE } }))
                  },
                  pageBreak: () => { builderUsed.used = true; children.push(new Paragraph({ children: [], pageBreakBefore: true })) },
                  save: async (): Promise<Uint8Array> => {
                    // @ts-ignore
                    return await Packer.toUint8Array(new Document({ sections: [{ properties: {}, children }] }))
                  }
                }
                const toolkit = {
                  json: async (prompt: string) => {
                    const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(row.workspaceSlug!)}/chat`, 'POST', { message: String(prompt), mode: 'query' })
                    const t = String(r?.textResponse || r?.message || r || '')
                    try { return JSON.parse(t) } catch {}
                    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (m && m[1]) { try { return JSON.parse(m[1]) } catch {} }
                    return []
                  },
                  query: async (prompt: string) => {
                    const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(row.workspaceSlug!)}/chat`, 'POST', { message: String(prompt), mode: 'query' })
                    const t = String(r?.textResponse || r?.message || r || '')
                    try { return JSON.parse(t) } catch {}
                    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (m && m[1]) { try { return JSON.parse(m[1]) } catch {} }
                    return t
                  },
                  text: async (prompt: string) => {
                    const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(row.workspaceSlug!)}/chat`, 'POST', { message: String(prompt), mode: 'query' })
                    return String(r?.textResponse || r?.message || r || '')
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
                const result = await generateFull(toolkit, builder, context)
                let outBuf: Buffer | null = null
                if ((tpl as any).kind === 'docx') {
                  if (result && (result as any).html) {
                    const merged = await mergeHtmlIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), String((result as any).html))
                    outBuf = merged
                  } else if (result && (result as any).markdown) {
                    const html = (marked as any).parse(String((result as any).markdown)) as string
                    const merged = await mergeHtmlIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), html)
                    outBuf = merged
                  } else if (result && (result as any).docx) {
                    const u8 = (result as any).docx as Uint8Array
                    const merged = await (await import('../services/docxCompose')).mergeDocxIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), Buffer.from(u8))
                    outBuf = merged
                  } else if (builderUsed.used) {
                    const u8 = await builder.save()
                    const merged = await (await import('../services/docxCompose')).mergeDocxIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), Buffer.from(u8))
                    outBuf = merged
                  }
                } else {
                  if (result && (result as any).html) {
                    const bufU8: Uint8Array = await (htmlToDocx as any)((result as any).html)
                    outBuf = Buffer.from(bufU8)
                  } else if (result && (result as any).markdown) {
                    const html = (marked as any).parse(String((result as any).markdown)) as string
                    const bufU8: Uint8Array = await (htmlToDocx as any)(html)
                    outBuf = Buffer.from(bufU8)
                  } else if (result && (result as any).docx) {
                    const u8 = (result as any).docx as Uint8Array
                    outBuf = Buffer.from(u8)
                  } else if (builderUsed.used) {
                    const u8 = await builder.save()
                    outBuf = Buffer.from(u8)
                  }
                }
                if (outBuf) {
                  const fnameLocal = (filename || (tpl as any).meta?.output?.filenamePattern || `${slug}-{{ts}}`).replace("{{ts}}", String(Date.now()))
                  const outPathLocal = path.join(docsDir, fnameLocal + '.docx')
                  fs.writeFileSync(outPathLocal, outBuf)
                  return res.status(201).json({ ok: true, file: { path: outPathLocal, name: path.basename(outPathLocal) }, usedWorkspace: row.workspaceSlug, generatorUsed: true, helperUsed: true, logs: [...logs, 'fullgen:ok'] })
                }
              }
            } catch (e:any) {
              logs.push(`fullgen:error ${(e?.message||e)}`)
            }
          }

          // Placeholder-based doc generators are no longer supported

          // Prefer TypeScript helper if present
          if (wsSlug && fs.existsSync(helperPath)) {
            try {
              usedWorkspace = wsSlug
              const tsCode = fs.readFileSync(helperPath, 'utf-8')
              const jsOut = ts.transpileModule(tsCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } })
              const sandbox: any = { module: { exports: {} }, exports: {}, console }
              vm.createContext(sandbox)
              const wrapped = `(function (module, exports) { ${jsOut.outputText}\n;return module.exports; })`
              const fn = vm.runInContext(wrapped, sandbox)
              const mod = fn(sandbox.module, sandbox.exports)
              const buildContext = mod?.buildContext
              if (typeof buildContext === 'function') {
                const toolkit = {
                  json: async (prompt: string) => {
                    const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(wsSlug!)}/chat`, 'POST', { message: String(prompt), mode: 'query' })
                    const t = String(r?.textResponse || r?.message || r || '')
                    try { return JSON.parse(t) } catch {}
                    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (m && m[1]) { try { return JSON.parse(m[1]) } catch {} }
                    return []
                  },
                  query: async (prompt: string) => {
                    const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(wsSlug!)}/chat`, 'POST', { message: String(prompt), mode: 'query' })
                    const t = String(r?.textResponse || r?.message || r || '')
                    try { return JSON.parse(t) } catch {}
                    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (m && m[1]) { try { return JSON.parse(m[1]) } catch {} }
                    return t
                  },
                  text: async (prompt: string) => {
                    const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(wsSlug!)}/chat`, 'POST', { message: String(prompt), mode: 'query' })
                    return String(r?.textResponse || r?.message || r || '')
                  }
                }
                const built = await buildContext(toolkit)
                if (built && typeof built === 'object') {
                  Object.assign(context, built)
                  helperUsed = true
                  generatorUsed = true
                  logs.push('helper:buildContext: ok')
                }
              }
            } catch (e:any) {
              logs.push(`helper:error ${(e?.message||e)}`)
            }
          }

          // Fallback to JSON script plan
          if (!helperUsed && wsSlug && fs.existsSync(scriptPath)) {
            const script = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'))
            const steps: Array<{ key: string; prompt: string; strategy?: string; description?: string }> = Array.isArray(script?.dataPlan) ? script.dataPlan : []
            if (steps.length) {
              usedWorkspace = wsSlug
              generatorUsed = true
              for (const step of steps) {
                if (!step?.key || !step?.prompt) continue
                const promptT = Handlebars.compile(String(step.prompt))
                const renderedPrompt = promptT(context)
                logs.push(`step:${step.key}: prompt length ${renderedPrompt.length}`)
                try {
                  const chat = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(wsSlug)}/chat`, 'POST', { message: renderedPrompt, mode: 'query' })
                  const text = String(chat?.textResponse || chat?.message || chat || '')
                  function tryParse(s: string): any {
                    try { return JSON.parse(s) } catch {}
                    const first = s.indexOf('{'), last = s.lastIndexOf('}')
                    if (first >= 0 && last > first) { const slice = s.slice(first, last + 1); try { return JSON.parse(slice) } catch {} }
                    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence && fence[1]) { try { return JSON.parse(fence[1]) } catch {} }
                    try { const arr = JSON.parse(`[${s}]`); if (Array.isArray(arr)) return arr } catch {}
                    return s
                  }
                  const parsed = tryParse(text)
                  if ((step.strategy || '').toLowerCase() === 'list' && !Array.isArray(parsed)) {
                    context[step.key] = Array.isArray(parsed) ? parsed : [parsed]
                  } else {
                    context[step.key] = parsed
                  }
                  logs.push(`step:${step.key}: ok`)
                } catch (e:any) {
                  logs.push(`step:${step.key}: error ${(e?.message||e)}`)
                }
              }
            }
          }
        } catch {}

        // Compose with AI to avoid brittle placeholders; fallback to renderer
        let outPath: string
        let composedMarkdown: string | null = null
        try {
          let skeleton = ''
          if ((tpl as any).kind === 'docx') {
            const buffer = fs.readFileSync((tpl as any).templatePath)
            const result = await (require('mammoth') as any).extractRawText({ buffer })
            skeleton = String(result?.value || '')
          } else {
            skeleton = String(renderTemplate((tpl as any).compiled, {}) || '')
          }
          const wsSlugForCompose = row.workspaceSlug || usedWorkspace
          if (wsSlugForCompose) {
            const composePrompt = `You are a professional technical writer. Compose a complete document in Markdown following the provided TEMPLATE structure. Use the provided CONTEXT data strictly; don't invent facts. Keep headings, lists, and tables consistent with the TEMPLATE. Return ONLY the Markdown with no extra commentary.\n\nCONTEXT (JSON):\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nTEMPLATE:\n\n\`\`\`\n${skeleton.slice(0, 12000)}\n\`\`\``
            const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(wsSlugForCompose))}/chat`, 'POST', { message: composePrompt, mode: 'query' })
            const t = String(r?.textResponse || r?.message || r || '')
            const m = t.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)
            composedMarkdown = m && m[1] ? m[1] : t
            if (composedMarkdown) logs.push('compose:ok')
          }
        } catch {}

        if (composedMarkdown) {
          const html = (require('marked') as any).marked.parse(composedMarkdown) as string
          const fname = (filename || tpl.meta?.output?.filenamePattern || `${slug}-{{ts}}`).replace("{{ts}}", String(Date.now()))
          const fmt = (tpl as any).kind === 'docx' ? 'docx' : ((tpl as any).meta?.output?.format || 'md')
          if (fmt === 'docx') {
            // Merge generated HTML into original DOCX to preserve headers/footers/styles
            const bufDocx = await mergeHtmlIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), html)
            outPath = path.join(docsDir, fname + '.docx')
            fs.writeFileSync(outPath, bufDocx)
          } else if (fmt === 'html') {
            outPath = path.join(docsDir, fname + '.html')
            fs.writeFileSync(outPath, html, 'utf-8')
          } else {
            outPath = path.join(docsDir, fname + '.md')
            fs.writeFileSync(outPath, composedMarkdown, 'utf-8')
          }
        } else if (tpl.kind === 'hbs') {
          const output = renderTemplate(tpl.compiled, context)
          let fmt = tpl.meta?.output?.format as ('html'|'md'|'txt'|undefined)
          if (!fmt) {
            try {
              const found = fs.readdirSync(tpl.dir).find((n) => /^source\./i.test(n))
              if (found) {
                const sExt = path.extname(found).toLowerCase()
                fmt = sExt === '.html' ? 'html' : (sExt === '.md' || sExt === '.markdown' ? 'md' : 'txt')
              }
            } catch {}
          }
          const ext = fmt === 'html' ? '.html' : (fmt === 'txt' ? '.txt' : '.md')
          const fname = (filename || tpl.meta?.output?.filenamePattern || `${slug}-{{ts}}`).replace("{{ts}}", String(Date.now()))
          outPath = path.join(docsDir, fname + ext)
          fs.writeFileSync(outPath, output, "utf-8")
        } else {
          // For DOCX templates without composed markdown, compose now and convert
          const buffer = fs.readFileSync((tpl as any).templatePath)
          const result = await (mammoth as any).extractRawText({ buffer })
          const skeleton = String(result?.value || '')
          const wsSlugForCompose = row.workspaceSlug || usedWorkspace
          if (wsSlugForCompose) {
            const composePrompt = `You are a professional technical writer. Compose a complete document in Markdown following the provided TEMPLATE structure. Use the provided CONTEXT data strictly; don't invent facts. Keep headings, lists, and tables consistent with the TEMPLATE. Return ONLY the Markdown with no extra commentary.\n\nCONTEXT (JSON):\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nTEMPLATE:\n\n\`\`\`\n${skeleton.slice(0, 12000)}\n\`\`\``
            const r = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(wsSlugForCompose))}/chat`, 'POST', { message: composePrompt, mode: 'query' })
            const t = String(r?.textResponse || r?.message || r || '')
            const m = t.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)
            const composed = m && m[1] ? m[1] : t
            const html = (marked as any).parse(composed) as string
            const bufDocx = await mergeHtmlIntoDocxTemplate(fs.readFileSync((tpl as any).templatePath), html)
            const fname = (filename || tpl.meta?.output?.filenamePattern || `${slug}-{{ts}}`).replace("{{ts}}", String(Date.now()))
            outPath = path.join(docsDir, fname + '.docx')
            fs.writeFileSync(outPath, bufDocx)
          } else {
            return res.status(400).json({ error: 'No workspace available to compose DOCX' })
          }
        }

        // Optionally embed into AnythingLLM by reusing uploads route contract (best-effort)
        if (embed) {
          try {
            // emulate upload by copying into uploads dir and calling /document/upload via existing service is heavy; we skip here.
          } catch {}
        }

        return res.status(201).json({ ok: true, file: { path: outPath, name: path.basename(outPath) }, ...(usedWorkspace ? { usedWorkspace } : {}), generatorUsed, helperUsed, ...(logs.length?{ logs }: {}) })
      } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
      }
    }
  )
})

export default router
