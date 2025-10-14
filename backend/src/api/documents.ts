// backend/src/api/documents.ts
import { Router } from "express"
import { getDB } from "../services/storage"
import { resolveCustomerPaths } from "../services/customerLibrary"
import { customerPaths } from "../services/fs"
import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { secureFileValidation } from "../services/fileSecurityValidator"

const router = Router()


// List documents for a customer
router.get("/:customerId", (req, res) => {
  const db = getDB()
  db.all(
    "SELECT * FROM documents WHERE customerId = ?",
    [req.params.customerId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(rows)
    }
  )
})

// List generated documents files from filesystem for a customer
router.get("/:customerId/files", (req, res) => {
  const db = getDB()
  db.get<{ id: number; name: string; createdAt: string }>(
    "SELECT id, name, createdAt FROM customers WHERE id = ?",
    [req.params.customerId],
    (err, customer) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!customer) return res.status(404).json({ error: "Customer not found" })

      const { documentsDir } = resolveCustomerPaths(customer.id, customer.name, new Date(customer.createdAt))
      
      try {
        if (!fs.existsSync(documentsDir)) {
          return res.json([])
        }

        const files = fs.readdirSync(documentsDir).map(filename => {
          const filePath = path.join(documentsDir, filename)
          const stats = fs.statSync(filePath)
          return {
            name: filename,
            path: filePath,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString()
          }
        }).filter(file => !file.name.startsWith('.')) // Filter out hidden files
        
        res.json(files)
      } catch (error) {
        res.status(500).json({ error: `Failed to read documents directory: ${(error as Error).message}` })
      }
    }
  )
})

// POST /api/documents/:customerId/open-file -> return file metadata for client-side opening
router.post("/:customerId/open-file", (req, res) => {
  const id = Number(req.params.customerId)
  const nameRaw = String(req.query.name || (req.body as any)?.name || "").trim()
  const name = path.basename(nameRaw)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })
  if (!name) return res.status(400).json({ error: "Missing file name" })

  // Security validation - prevent opening executable/dangerous files
  const validation = secureFileValidation(name, true) // Use whitelist mode for strict security
  if (!validation.allowed) {
    return res.status(403).json({ 
      error: "File type not allowed", 
      reason: validation.reason,
      extension: validation.extension 
    })
  }

  const db = getDB()
  db.get<{ id: number; name: string; createdAt: string }>(
    "SELECT id, name, createdAt FROM customers WHERE id = ?",
    [id],
    (err, customer) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!customer) return res.status(404).json({ error: "Customer not found" })

      const { documentsDir } = resolveCustomerPaths(customer.id, customer.name, new Date(customer.createdAt))

      try {
        fs.mkdirSync(documentsDir, { recursive: true })
        const target = path.join(documentsDir, name)
        const safeBase = path.resolve(documentsDir)
        const safeTarget = path.resolve(target)
        if (!safeTarget.startsWith(safeBase)) return res.status(400).json({ error: "Invalid file path" })
        if (!fs.existsSync(safeTarget)) return res.status(404).json({ error: "File not found" })
        return res.json({ ok: true, path: safeTarget, extension: path.extname(safeTarget) })
      } catch (error) {
        return res.status(500).json({ error: `Failed to open file: ${(error as Error).message}` })
      }
    }
  )
})
// POST /api/documents/:customerId/open-folder -> open the documents folder in the host OS file explorer
router.post("/:customerId/open-folder", (req, res) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })

  const db = getDB()
  db.get<{ id: number; name: string; createdAt: string }>(
    "SELECT id, name, createdAt FROM customers WHERE id = ?",
    [id],
    (_err, row) => {
      if (!row) return res.status(404).json({ error: "Customer not found" })
      try {
        const { documentsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
        fs.mkdirSync(documentsDir, { recursive: true })

        const platform = process.platform
        let cmd: string
        let args: string[]
        if (platform === 'win32') {
          cmd = 'explorer'
          args = [documentsDir]
        } else if (platform === 'darwin') {
          cmd = 'open'
          args = [documentsDir]
        } else {
          cmd = 'xdg-open'
          args = [documentsDir]
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

// GET /api/documents/:customerId/file?name=FILENAME -> stream a file for viewing/downloading
router.get("/:customerId/file", (req, res) => {
  const id = Number(req.params.customerId)
  const nameRaw = String(req.query.name || "")
  const name = path.basename(nameRaw)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })
  if (!name) return res.status(400).json({ error: "Missing file name" })

  const db = getDB()
  db.get<{ id: number; name: string; createdAt: string }>(
    "SELECT id, name, createdAt FROM customers WHERE id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })
      try {
        const { documentsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
        fs.mkdirSync(documentsDir, { recursive: true })
        const target = path.join(documentsDir, name)
        const safeBase = path.resolve(documentsDir)
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

// Stub: create a document record (real generation hooked up later)
router.post("/", (req, res) => {
  const { customerId, type } = req.body as { customerId?: number; type?: string }
  if (!customerId || !type) {
    return res.status(400).json({ error: "customerId and type required" })
  }

  const db = getDB()
  // Resolve customer's folder paths based on name + createdAt
  db.get<{ id: number; name: string; createdAt: string }>(
    "SELECT id, name, createdAt FROM customers WHERE id = ?",
    [customerId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })

      const { documentsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
      try { fs.mkdirSync(documentsDir, { recursive: true }) } catch {}

      const filename = `${type}-${Date.now()}.docx`
      const filePath = path.join(documentsDir, filename)

      db.run(
        "INSERT INTO documents (customerId, type, filePath) VALUES (?, ?, ?)",
        [row.id, type, filePath],
        function (dErr) {
          if (dErr) return res.status(500).json({ error: dErr.message })
          res.json({ id: this.lastID, customerId: row.id, type, filePath })
        }
      )
    }
  )
})

// DELETE /api/documents/:customerId/file?name=... — delete a generated document file
router.delete("/:customerId/file", (req, res) => {
  const customerId = Number(req.params.customerId)
  const fileName = req.query.name ? String(req.query.name) : undefined
  
  if (!customerId || !fileName) {
    return res.status(400).json({ error: "customerId and name are required" })
  }

  const db = getDB()
  db.get<{ id: number; name: string; createdAt: string }>(
    "SELECT id, name, createdAt FROM customers WHERE id = ?",
    [customerId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })

      const { documentsDir } = customerPaths(row.id, row.name, new Date(row.createdAt))
      const filePath = path.join(documentsDir, fileName)

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" })
      }

      try {
        // Delete the file
        fs.unlinkSync(filePath)
        res.json({ success: true, message: "Document deleted successfully" })
      } catch (deleteErr: any) {
        return res.status(500).json({ error: deleteErr.message || "Failed to delete file" })
      }
    }
  )
})

export default router

