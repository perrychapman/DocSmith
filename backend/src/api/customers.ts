// backend/src/api/customers.ts
import { Router } from "express"
import { getDB } from "../services/storage"
import { rmrf } from "../services/fs"
import { ensureCustomerLibrary, resolveCustomerPaths, folderNameForCustomer } from "../services/customerLibrary"
import { ensureCustomersWorkspaceSlugColumn } from "../services/storage"
import { anythingllmRequest } from "../services/anythingllm"

const router = Router()

type CustomerRow = {
  id: number
  name: string
  workspaceSlug?: string | null
  createdAt: string
}

// GET /api/customers  — list customers (newest first)
router.get("/", (_req, res) => {
  const db = getDB()
  db.all< CustomerRow[] >(
    "SELECT id, name, workspaceSlug, createdAt FROM customers ORDER BY datetime(createdAt) DESC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message })
      res.json(rows)
    }
  )
})

// POST /api/customers  — create customer + folders {Name}_{Mon_Year}
router.post("/", (req, res) => {
  let { name } = req.body as { name?: string }
  name = (name || "").trim()
  if (!name) return res.status(400).json({ error: "Name is required" })

  const db = getDB()
  const createdAt = new Date().toISOString()

  db.run(
    "INSERT INTO customers (name, createdAt) VALUES (?, ?)",
    [name, createdAt],
    async function (err) {
      if (err) return res.status(500).json({ error: err.message })

      // Create LIBRARY_ROOT/customers/{CustomerName}_{Mon_Year}/(inputs|prompts|documents)
      let folderWarning: string | undefined
      let workspaceWarning: string | undefined
      let workspace: { name?: string; slug?: string } | undefined
      try {
        ensureCustomerLibrary(this.lastID, name!, new Date(createdAt))
      } catch (e) {
        folderWarning = `Customer created, but failed to create folders: ${(e as Error).message}`
      }

      const { customerDir } = resolveCustomerPaths(this.lastID, name!, new Date(createdAt))

      // Also create AnythingLLM workspace titled the same as the folder name
      try {
        const folderName = folderNameForCustomer(this.lastID, name!, new Date(createdAt))
        const resp = await anythingllmRequest<{ workspace: { id: number; name: string; slug: string }; message: string }>(
          "/workspace/new",
          "POST",
          { name: folderName }
        )
        workspace = { name: resp?.workspace?.name, slug: resp?.workspace?.slug }
        // Persist slug on the customer row
        try {
          const db2 = getDB()
          ensureCustomersWorkspaceSlugColumn(db2)
          if (resp?.workspace?.slug) {
            await new Promise<void>((resolve) => {
              db2.run(
                "UPDATE customers SET workspaceSlug = ? WHERE id = ?",
                [resp.workspace.slug, this.lastID],
                () => resolve()
              )
            })
          }
        } catch {}
      } catch (e) {
        workspaceWarning = `Customer created, but failed to create AnythingLLM workspace: ${(e as Error).message}`
      }
      return res.status(201).json({
        id: this.lastID,
        name,
        createdAt,
        folder: customerDir,
        ...(folderWarning ? { warning: folderWarning } : {}),
        ...(workspace ? { workspace } : {}),
        ...(workspaceWarning ? { workspaceWarning } : {})
      })
    }
  )
})

// DELETE /api/customers/:id  — cascade delete (documents, prompts, customer) + remove folder
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id" })
  }

  const db = getDB()
  const alsoDeleteWorkspace = String((req.query.deleteWorkspace ?? "")).toLowerCase()
    .replace(/\s+/g, "")
    .trim();
  const shouldDeleteWorkspace = alsoDeleteWorkspace === "true" || alsoDeleteWorkspace === "1";

  // 1) Load customer (need name/createdAt to resolve folder)
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })

      const createdAtDate = new Date(row.createdAt)
      const { customerDir } = resolveCustomerPaths(id, row.name, createdAtDate)
      const folderName = folderNameForCustomer(id, row.name, createdAtDate)

      // 2) Delete DB rows in a transaction
      db.serialize(() => {
        db.run("BEGIN", (beginErr) => {
          if (beginErr) return res.status(500).json({ error: beginErr.message })

          db.run("DELETE FROM documents WHERE customerId = ?", [id], (d1Err) => {
            if (d1Err) {
              db.run("ROLLBACK", () => res.status(500).json({ error: d1Err.message }))
              return
            }

            db.run("DELETE FROM prompts WHERE customerId = ?", [id], (d2Err) => {
              if (d2Err) {
                db.run("ROLLBACK", () => res.status(500).json({ error: d2Err.message }))
                return
              }

              db.run("DELETE FROM customers WHERE id = ?", [id], (d3Err) => {
                if (d3Err) {
                  db.run("ROLLBACK", () => res.status(500).json({ error: d3Err.message }))
                  return
                }

                db.run("COMMIT", async (commitErr) => {
                  if (commitErr) return res.status(500).json({ error: commitErr.message })

                  // 3) Remove filesystem folder (best-effort)
                  let warning: string | undefined
                  try {
                    rmrf(customerDir)
                  } catch (e) {
                    warning = `Deleted from DB, but failed to remove folder: ${(e as Error).message}`
                  }

                  // 4) Optionally remove the AnythingLLM workspace with the same folderName
                  let workspaceWarning: string | undefined
                  if (shouldDeleteWorkspace) {
                    try {
                      const slug = (row as any)?.workspaceSlug
                      if (slug) {
                        await anythingllmRequest(`/workspace/${encodeURIComponent(slug)}`, "DELETE")
                      } else {
                        // Fallback: find by name
                        const list = await anythingllmRequest<{ workspaces: Array<{ name: string; slug: string }> }>(
                          "/workspaces",
                          "GET"
                        )
                        const ws = Array.isArray((list as any)?.workspaces) ? (list as any).workspaces : Array.isArray(list) ? (list as any) : []
                        const match = ws.find((w: any) => (w?.name || "") === folderName)
                        if (match?.slug) await anythingllmRequest(`/workspace/${encodeURIComponent(match.slug)}`, "DELETE")
                        else workspaceWarning = `No AnythingLLM workspace named '${folderName}' found`
                      }
                    } catch (e) {
                      workspaceWarning = `Failed to delete AnythingLLM workspace: ${(e as Error).message}`
                    }
                  }

                  return res.json({ ok: true, id, ...(warning ? { warning } : {}), ...(workspaceWarning ? { workspaceWarning } : {}) })
                })
              })
            })
          })
        })
      })
    }
  )
})

// GET /api/customers/:id/workspace - resolve AnythingLLM workspace for this customer by folder-based name
router.get("/:id/workspace", (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" })

  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })
      try {
        if (row.workspaceSlug) return res.json({ slug: row.workspaceSlug })
        const folderName = folderNameForCustomer(row.id, row.name, new Date(row.createdAt))
        const list = await anythingllmRequest<{ workspaces: Array<{ name: string; slug: string }> }>("/workspaces", "GET")
        const arr = Array.isArray((list as any)?.workspaces)
          ? (list as any).workspaces
          : Array.isArray(list)
          ? (list as any)
          : []
        const match = arr.find((w: any) => (w?.name || "") === folderName)
        if (match?.slug) return res.json({ name: match.name, slug: match.slug })
        return res.status(404).json({ error: "Workspace not found" })
      } catch (e) {
        return res.status(502).json({ error: `Failed to resolve workspace: ${(e as Error).message}` })
      }
    }
  )
})

export default router
