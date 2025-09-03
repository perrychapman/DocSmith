// backend/src/api/generate.ts
import { Router } from "express"
import fs from "fs"
import path from "path"
import { getDB } from "../services/storage"
import { renderTemplate, loadTemplate } from "../services/templateEngine"
import { ensureDocumentsDir, resolveCustomerPaths } from "../services/customerLibrary"
import { libraryRoot } from "../services/fs"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PizZip = require('pizzip')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Docxtemplater = require('docxtemplater')

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

        const context = { customer: { id: row.id, name: row.name }, now: new Date().toISOString(), ...(data || {}) }
        let outPath: string
        if (tpl.kind === 'hbs') {
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
          // DOCX generation using docxtemplater
          const content = fs.readFileSync(tpl.templatePath, 'binary')
          const zip = new PizZip(content)
          const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
          doc.setData(context)
          try { doc.render() } catch (e) {
            return res.status(400).json({ error: `DOCX render failed: ${(e as Error).message}` })
          }
          const buf = doc.getZip().generate({ type: 'nodebuffer' })
          const fname = (filename || tpl.meta?.output?.filenamePattern || `${slug}-{{ts}}`).replace("{{ts}}", String(Date.now()))
          outPath = path.join(docsDir, fname + '.docx')
          fs.writeFileSync(outPath, buf)
        }

        // Optionally embed into AnythingLLM by reusing uploads route contract (best-effort)
        if (embed) {
          try {
            // emulate upload by copying into uploads dir and calling /document/upload via existing service is heavy; we skip here.
          } catch {}
        }

        return res.status(201).json({ ok: true, file: { path: outPath, name: path.basename(outPath) } })
      } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
      }
    }
  )
})

export default router
