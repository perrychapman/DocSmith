// backend/src/api/test.ts
import { Router } from "express"
import { resetDatabase } from "../services/storage"
import { libraryRoot, rmrf } from "../services/fs"
import path from "path"
import fs from "fs"

const router = Router()

/**
 * GET /api/test
 * Simple health check endpoint
 */
router.get("/", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

/**
 * POST /api/test/reset
 * Wipes SQLite DB and clears library folders (customers + .cache).
 * For local dev/testing only.
 */
router.post("/reset", async (req, res) => {
  try {
    // 1) reset the SQLite DB
    await resetDatabase()

    // 2) clean library folders (keep the root itself)
    const root = libraryRoot()
    const customersDir = path.join(root, "customers")
    const cacheDir = path.join(root, ".cache")

    // remove subtrees
    try { if (fs.existsSync(customersDir)) rmrf(customersDir) } catch {}
    try { if (fs.existsSync(cacheDir)) rmrf(cacheDir) } catch {}

    // recreate empty folders so the app has a clean state
    fs.mkdirSync(customersDir, { recursive: true })

    return res.json({ ok: true })
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message })
  }
})

export default router
