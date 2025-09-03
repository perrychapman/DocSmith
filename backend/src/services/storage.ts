import sqlite3 from "sqlite3"
import path from "path"
import fs from "fs"

let db: sqlite3.Database | null = null

export function getDB(): sqlite3.Database {
  if (!db) {
    const dbPath = path.resolve(__dirname, "../../data/app.sqlite")
    const schemaPath = path.resolve(__dirname, "../db/schema.sql")

    // Ensure /data exists
    const dataDir = path.resolve(__dirname, "../../data")
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

    db = new sqlite3.Database(dbPath)

    // Run schema
    const schema = fs.readFileSync(schemaPath, "utf8")
    db.exec(schema)
    // Lightweight migrations for existing DBs
    try { ensureCustomersWorkspaceSlugColumn(db) } catch {}
  }
  return db
}

// Close and delete the SQLite DB file; next getDB() call will recreate & re-run schema
export async function resetDatabase(): Promise<void> {
  const dbPath = path.resolve(__dirname, "../../data/app.sqlite")

  // Close the current db handle if open
  await new Promise<void>((resolve) => {
    if (!db) return resolve()
    db.close(() => {
      db = null
      resolve()
    })
  })

  // Remove the DB file
  try {
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { force: true })
    }
  } catch {
    // ignore
  }
}

// --- Lightweight migration helpers ---
export function ensureCustomersWorkspaceSlugColumn(handle: sqlite3.Database) {
  handle.serialize(() => {
    handle.all("PRAGMA table_info(customers)", (err, rows: any[]) => {
      if (err) return
      const has = Array.isArray(rows) && rows.some((r) => String(r?.name) === "workspaceSlug")
      if (has) return
      handle.run("ALTER TABLE customers ADD COLUMN workspaceSlug TEXT", () => {})
    })
  })
}

