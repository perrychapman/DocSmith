import sqlite3 from "sqlite3"
import path from "path"
import fs from "fs"
import { runMigrations } from "./migrations"

let db: sqlite3.Database | null = null

export function getDB(): sqlite3.Database {
  if (!db) {
    const dbPath = path.resolve(__dirname, "../../data/app.sqlite")
    
    // Try multiple possible schema paths (development vs production/bundled)
    const possibleSchemaPaths = [
      path.resolve(__dirname, "../db/schema.sql"),      // Development
      path.resolve(__dirname, "./db/schema.sql"),       // Bundled (esbuild flattens structure)
      path.resolve(__dirname, "db/schema.sql")          // Alternative bundled path
    ]
    
    let schemaPath: string | null = null
    for (const possiblePath of possibleSchemaPaths) {
      if (fs.existsSync(possiblePath)) {
        schemaPath = possiblePath
        break
      }
    }
    
    if (!schemaPath) {
      throw new Error(`Could not find schema.sql in any of these locations: ${possibleSchemaPaths.join(", ")}`)
    }

    // Ensure /data exists
    const dataDir = path.resolve(__dirname, "../../data")
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

    db = new sqlite3.Database(dbPath)

    // Run base schema (CREATE TABLE IF NOT EXISTS ensures safe idempotence)
    const schema = fs.readFileSync(schemaPath, "utf8")
    db.exec(schema)
    
    // Run migrations asynchronously (non-blocking)
    runMigrations(db).catch(err => {
      console.error('[DB] Migration error:', err)
    })
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
