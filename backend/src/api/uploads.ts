// backend/src/api/uploads.ts
import { Router } from "express"
import path from "path"
import fs from "fs"
import { spawn } from "child_process"
import type { Request } from "express"
import { getDB } from "../services/storage"
import { ensureUploadsDir, resolveCustomerPaths } from "../services/customerLibrary"
import { anythingllmRequest } from "../services/anythingllm"
import { findDocsByFilename, documentExists, qualifiedNamesForShort } from "../services/anythingllmDocs"

// Lazy import multer to avoid types requirement at compile time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require("multer")

const router = Router()

type CustomerRow = { id: number; name: string; workspaceSlug?: string | null; createdAt: string }

// --- Local sidecar mapping helpers (store AnythingLLM doc mapping next to upload) ---
type Sidecar = {
  docName: string
  docId?: string
  workspaceSlug?: string
  uploadedAt: string
}

function sidecarPath(uploadsDir: string, filename: string) {
  return path.join(uploadsDir, `${filename}.allm.json`)
}

function writeSidecar(uploadsDir: string, filename: string, data: Sidecar) {
  try { fs.writeFileSync(sidecarPath(uploadsDir, filename), JSON.stringify(data, null, 2), "utf-8") } catch {}
}

function readSidecar(uploadsDir: string, filename: string): Sidecar | null {
  try {
    const p = sidecarPath(uploadsDir, filename)
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Sidecar
  } catch { return null }
}

function removeSidecar(uploadsDir: string, filename: string) {
  try { const p = sidecarPath(uploadsDir, filename); if (fs.existsSync(p)) fs.unlinkSync(p) } catch {}
}

// GET /api/uploads/:customerId -> list files in uploads folder
router.get("/:customerId", (req, res) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })

  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })
      try {
        const { uploadsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
        fs.mkdirSync(uploadsDir, { recursive: true })
        const items = fs
          .readdirSync(uploadsDir, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => {
            const full = path.join(uploadsDir, e.name)
            const stat = fs.statSync(full)
            return {
              name: e.name,
              path: full,
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            }
          })
          .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
        return res.json(items)
      } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
      }
    }
  )
})

// GET /api/uploads/:customerId/file?name=FILENAME -> stream a file for viewing/downloading
router.get("/:customerId/file", (req, res) => {
  const id = Number(req.params.customerId)
  const nameRaw = String(req.query.name || "")
  const name = path.basename(nameRaw)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })
  if (!name) return res.status(400).json({ error: "Missing file name" })

  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })
      try {
        const { uploadsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
        fs.mkdirSync(uploadsDir, { recursive: true })
        const target = path.join(uploadsDir, name)
        const safeBase = path.resolve(uploadsDir)
        const safeTarget = path.resolve(target)
        if (!safeTarget.startsWith(safeBase)) return res.status(400).json({ error: "Invalid file path" })
        if (!fs.existsSync(safeTarget)) return res.status(404).json({ error: "File not found" })
        return res.sendFile(safeTarget)
      } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
      }
    }
  )
})

// GET /api/uploads/:customerId/browse -> simple HTML listing for the uploads folder
router.get("/:customerId/browse", (req, res) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send("Invalid customerId")

  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    (_err, row) => {
      if (!row) return res.status(404).send("Customer not found")
      try {
        const { uploadsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
        fs.mkdirSync(uploadsDir, { recursive: true })
        const items = fs
          .readdirSync(uploadsDir, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => {
            const full = path.join(uploadsDir, e.name)
            const stat = fs.statSync(full)
            return { name: e.name, size: stat.size, m: stat.mtime }
          })
          .sort((a, b) => (a.m < b.m ? 1 : -1))
        const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        const rows = items
          .map((it) => {
            const href = `/api/uploads/${encodeURIComponent(String(id))}/file?name=${encodeURIComponent(it.name)}`
            const dt = new Date(it.m).toLocaleString()
            const size = it.size
            return `<tr><td style="padding:4px 8px"><a href="${href}" target="_blank" rel="noopener">${esc(it.name)}</a></td><td style="padding:4px 8px;text-align:right">${size}</td><td style=\"padding:4px 8px;color:#666\">${esc(dt)}</td></tr>`
          })
          .join("")
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Uploads for ${esc(row.name)}</title>
          <style>body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.4;padding:16px}table{border-collapse:collapse;width:100%;max-width:900px}th,td{border-bottom:1px solid #eee;font-size:14px}th{color:#555;text-align:left}</style>
          </head><body>
          <h2 style="margin:0 0 8px">Uploads for ${esc(row.name)}</h2>
          <div style="margin:0 0 12px;color:#666">Customer ID: ${row.id}</div>
          <table><thead><tr><th>Name</th><th style="text-align:right">Size</th><th>Modified</th></tr></thead><tbody>${rows || '<tr><td colspan="3" style="padding:8px;color:#666">No files</td></tr>'}</tbody></table>
          </body></html>`
        res.status(200).send(html)
      } catch (e) {
        res.status(500).send((e as Error).message)
      }
    }
  )
})

// POST /api/uploads/:customerId/open-folder -> open the uploads folder in the host OS file explorer
router.post("/:customerId/open-folder", (req, res) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })

  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    (_err, row) => {
      if (!row) return res.status(404).json({ error: "Customer not found" })
      try {
        const { uploadsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
        fs.mkdirSync(uploadsDir, { recursive: true })

        const platform = process.platform
        let cmd: string
        let args: string[]
        if (platform === 'win32') {
          cmd = 'explorer'
          // explorer handles forward/back slashes; ensure proper quoting via args
          args = [uploadsDir]
        } else if (platform === 'darwin') {
          cmd = 'open'
          args = [uploadsDir]
        } else {
          cmd = 'xdg-open'
          args = [uploadsDir]
        }
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
        child.unref()
        return res.json({ ok: true })
      } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
      }
    }
  )
})

// POST /api/uploads/:customerId -> upload a file to uploads folder and trigger embedding update
// expects multipart/form-data with field name "file"
router.post("/:customerId", (req, res, next) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })

  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })

      const uploadsDir = ensureUploadsDir(row.id, row.name, new Date(row.createdAt))
      const storage = multer.diskStorage({
        destination: (_req: any, _file: any, cb: any) => cb(null, uploadsDir),
        filename: (_req: any, file: any, cb: any) => {
          // Keep original name; can prefix timestamp if desired
          const base = path.basename(file.originalname)
          cb(null, base)
        },
      })
      const upload = multer({ storage })

      upload.single("file")( 
        req as Request,
        res,
        async (uErr: any) => {
          if (uErr) return res.status(400).json({ error: String(uErr?.message || uErr) })
          const file = (req as any).file as { filename: string; path: string } | undefined
          if (!file) return res.status(400).json({ error: "No file uploaded" })
          // Trigger AnythingLLM upload + embed into workspace, then persist mapping sidecar
          try {
            const slug = row.workspaceSlug
            if (slug) {
              try {
                const fd = new FormData()
                const buf = fs.readFileSync(file.path)
                const uint = new Uint8Array(buf)
                // @ts-ignore File is available in Node 18+
                const theFile = new File([uint], file.filename)
                fd.append("file", theFile)
                fd.append("addToWorkspaces", slug)
                const resp = await anythingllmRequest<any>("/document/upload", "POST", fd)

                // Attempt to capture the precise document mapping (name + id)
                let docName: string | undefined
                try {
                  const docs = Array.isArray(resp?.documents) ? resp.documents : []
                  const first = docs[0]
                  if (first?.name) docName = String(first.name)
                  // If we got a docName, try to resolve its id via GET /document/:name
                  let docId: string | undefined
                  if (docName) {
                    try {
                      const one = await anythingllmRequest<any>(`/document/${encodeURIComponent(docName)}`, "GET")
                      const items = Array.isArray(one?.localFiles?.items) ? one.localFiles.items : []
                      const match = items.find((x: any) => (String(x?.name || "") === docName))
                      if (match?.id) docId = String(match.id)
                    } catch {}
                  }
                  if (docName) {
                    writeSidecar(uploadsDir, file.filename, { docName, docId, workspaceSlug: slug, uploadedAt: new Date().toISOString() })
                  }
                } catch {}
              } catch (e) {
                return res.status(201).json({
                  ok: true,
                  file: { name: file.filename, path: file.path },
                  embeddingWarning: `Uploaded, but embedding update failed: ${(e as Error).message}`,
                })
              }
            }
            return res.status(201).json({ ok: true, file: { name: file.filename, path: file.path } })
          } catch (e) {
            return res.status(201).json({ ok: true, file: { name: file.filename, path: file.path }, warning: (e as Error).message })
          }
        }
      )
    }
  )
})

export default router
// DELETE /api/uploads/:customerId?name=filename.ext
// Deletes the local uploaded file and removes matching documents from AnythingLLM workspace
router.delete("/:customerId", (req, res) => {
  const id = Number(req.params.customerId)
  const name = String(req.query.name || (req.body as any)?.name || "").trim()
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })
  if (!name) return res.status(400).json({ error: "Missing file name" })

  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })

      const { uploadsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
      fs.mkdirSync(uploadsDir, { recursive: true })

      // Delete local file safely
      const target = path.join(uploadsDir, name)
      const safeBase = path.resolve(uploadsDir)
      const safeTarget = path.resolve(target)
      if (!safeTarget.startsWith(safeBase)) return res.status(400).json({ error: "Invalid file path" })

      let removedLocal = false
      try {
        if (fs.existsSync(safeTarget)) { fs.unlinkSync(safeTarget); removedLocal = true }
      } catch {}

      // Remove from AnythingLLM by robust two-step (with verification & fallbacks)
      let removedNames: string[] = []
      let documentsWarning: string | undefined
      const slug = row.workspaceSlug
      if (slug) {
        try {
          // Prefer sidecar mapping first for exact delete
          let names: string[] = []
          const sc = readSidecar(uploadsDir, name)
          if (sc?.docName) {
            try {
              const qnames = await qualifiedNamesForShort(sc.docName)
              names = qnames.length ? qnames : [sc.docName]
            } catch { names = [sc.docName] }
          }
          // Prefer global documents list, attempt pinned match first, then loose match
          try { if (!names.length) names = await findDocsByFilename(name, slug || undefined) } catch {}
          // Fallback to workspace documents listing
          if (!names.length) {
            const ws = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(String(slug))}`, "GET")
            const workspace = (ws as any)?.workspace ?? ws
            const docsArr: any[] = Array.isArray(workspace?.documents) ? workspace.documents : []
            const matches = docsArr.filter((d: any) => {
              const t = String(d?.title || "").trim()
              const c = String(d?.chunkSource || "").trim()
              return t === name || c === name
            })
            names = matches.map((d: any) => String(d?.name || d?.location || "")).filter(Boolean)
          }
          // Verify candidates exist using /document/:name (tolerate 404 by skipping)
          if (names.length) {
            const verified: string[] = []
            for (const n of names) {
              if (await documentExists(n)) verified.push(n)
            }
            names = verified
          }
          async function verifyGone(doc: string) {
            try { await anythingllmRequest<any>(`/document/${encodeURIComponent(doc)}`, "GET"); return false } catch { return true }
          }

          async function deleteDoc(doc: string) {
            const wsPath = `/workspace/${encodeURIComponent(String(slug))}/update-embeddings`
            const sysPath = `/system/remove-documents`
            let ok = false
            const qualified = doc
            const short = doc.includes('/') ? (doc.split('/').pop() as string) : doc
            const candidatesDeletes = Array.from(new Set([qualified, short]))
            const candidatesNames = candidatesDeletes

            // Attempt with both qualified and short
            for (const d of candidatesDeletes) { try { await anythingllmRequest(wsPath, "POST", { deletes: [d] }) } catch {} }
            for (const n of candidatesNames) { try { await anythingllmRequest(sysPath, "DELETE", { names: [n] }) ; ok = true } catch {} }
            if (!await verifyGone(doc)) {
              // Retry in reverse order
              for (const n of candidatesNames) { try { await anythingllmRequest(sysPath, "DELETE", { names: [n] }) } catch {} }
              for (const d of candidatesDeletes) { try { await anythingllmRequest(wsPath, "POST", { deletes: [d] }) } catch {} }
              ok = await verifyGone(doc)
            }
            return ok
          }

          if (names.length) {
            const actuallyRemoved: string[] = []
            for (const doc of names) {
              const ok = await deleteDoc(doc)
              if (ok) actuallyRemoved.push(doc)
            }
            if (actuallyRemoved.length) {
              removedNames = actuallyRemoved
              // Remove sidecar after successful removal (only if all removed)
              try { if (actuallyRemoved.length === names.length) removeSidecar(uploadsDir, name) } catch {}
            }
          }
        } catch (e) {
          documentsWarning = `Failed to remove AnythingLLM documents: ${(e as Error).message}`
        }
      }

      return res.json({ ok: true, removedLocal, removedNames, ...(documentsWarning ? { documentsWarning } : {}) })
    }
  )
})
