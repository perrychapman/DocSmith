// backend/src/api/documents.ts
import { Router } from "express"
import { getDB } from "../services/storage"
import { resolveCustomerPaths } from "../services/customerLibrary"
import fs from "fs"
import path from "path"

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

export default router
