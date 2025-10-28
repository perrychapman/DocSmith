import sqlite3 from "sqlite3"
import fs from "fs"
import path from "path"

export interface Migration {
  version: number
  name: string
  up: (db: sqlite3.Database) => Promise<void>
}

// Migration registry - add new migrations here
const migrations: Migration[] = [
  {
    version: 1,
    name: "add-workspace-slug-to-customers",
    up: async (db: sqlite3.Database) => {
      return new Promise((resolve, reject) => {
        db.run("ALTER TABLE customers ADD COLUMN workspaceSlug TEXT", (err) => {
          if (err && !err.message.includes("duplicate column")) {
            return reject(err)
          }
          resolve()
        })
      })
    }
  },
  {
    version: 2,
    name: "add-extra-fields-to-document-metadata",
    up: async (db: sqlite3.Database) => {
      return new Promise((resolve, reject) => {
        db.run("ALTER TABLE document_metadata ADD COLUMN extraFields TEXT", (err) => {
          if (err && !err.message.includes("duplicate column")) {
            return reject(err)
          }
          resolve()
        })
      })
    }
  },
  {
    version: 3,
    name: "add-anythingllm-path-to-document-metadata",
    up: async (db: sqlite3.Database) => {
      return new Promise((resolve, reject) => {
        db.run("ALTER TABLE document_metadata ADD COLUMN anythingllmPath TEXT", (err) => {
          if (err && !err.message.includes("duplicate column")) {
            return reject(err)
          }
          resolve()
        })
      })
    }
  },
  {
    version: 4,
    name: "add-template-generation-stats",
    up: async (db: sqlite3.Database) => {
      return new Promise((resolve, reject) => {
        db.serialize(() => {
          // Add fields to template_metadata
          db.run("ALTER TABLE template_metadata ADD COLUMN actualGenerationTimes TEXT", (err1) => {
            if (err1 && !err1.message.includes("duplicate column")) {
              return reject(err1)
            }
            
            db.run("ALTER TABLE template_metadata ADD COLUMN generationCount INTEGER DEFAULT 0", (err2) => {
              if (err2 && !err2.message.includes("duplicate column")) {
                return reject(err2)
              }
              
              db.run("ALTER TABLE template_metadata ADD COLUMN avgGenerationTime REAL", (err3) => {
                if (err3 && !err3.message.includes("duplicate column")) {
                  return reject(err3)
                }
                
                db.run("ALTER TABLE template_metadata ADD COLUMN lastGeneratedAt TIMESTAMP", (err4) => {
                  if (err4 && !err4.message.includes("duplicate column")) {
                    return reject(err4)
                  }
                  
                  // Add fields to gen_cards
                  db.run("ALTER TABLE gen_cards ADD COLUMN startedAt TIMESTAMP", (err5) => {
                    if (err5 && !err5.message.includes("duplicate column")) {
                      return reject(err5)
                    }
                    
                    db.run("ALTER TABLE gen_cards ADD COLUMN completedAt TIMESTAMP", (err6) => {
                      if (err6 && !err6.message.includes("duplicate column")) {
                        return reject(err6)
                      }
                      
                      db.run("ALTER TABLE gen_cards ADD COLUMN generationTimeSeconds REAL", (err7) => {
                        if (err7 && !err7.message.includes("duplicate column")) {
                          return reject(err7)
                        }
                        resolve()
                      })
                    })
                  })
                })
              })
            })
          })
        })
      })
    }
  },
  {
    version: 5,
    name: "add-last-compile-instructions-to-template-metadata",
    up: async (db: sqlite3.Database) => {
      return new Promise((resolve, reject) => {
        db.run("ALTER TABLE template_metadata ADD COLUMN lastCompileInstructions TEXT", (err) => {
          if (err && !err.message.includes("duplicate column")) {
            return reject(err)
          }
          resolve()
        })
      })
    }
  },
  {
    version: 6,
    name: "add-customer-sailpoint-config",
    up: async (db: sqlite3.Database) => {
      return new Promise((resolve, reject) => {
        const sql = `
          CREATE TABLE IF NOT EXISTS customer_sailpoint_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customerId INTEGER NOT NULL,
            sandboxTenantUrl TEXT DEFAULT '',
            sandboxClientId TEXT DEFAULT '',
            sandboxClientSecret TEXT DEFAULT '',
            prodTenantUrl TEXT DEFAULT '',
            prodClientId TEXT DEFAULT '',
            prodClientSecret TEXT DEFAULT '',
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
          )
        `;
        
        db.run(sql, (err) => {
          if (err && !err.message.includes("already exists")) {
            return reject(err)
          }
          
          // Create unique index
          db.run(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_sailpoint_config ON customer_sailpoint_config(customerId)",
            (indexErr) => {
              if (indexErr && !indexErr.message.includes("already exists")) {
                return reject(indexErr)
              }
              resolve()
            }
          )
        })
      })
    }
  },
  {
    version: 7,
    name: "add-chat-messages-table",
    up: async (db: sqlite3.Database) => {
      return new Promise((resolve, reject) => {
        const sql = `
          CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspaceSlug TEXT NOT NULL,
            customerId INTEGER,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            conversationId TEXT,
            messageIndex INTEGER DEFAULT 0,
            sailpointContext TEXT,
            sessionId TEXT DEFAULT 'user-interactive',
            isVisible INTEGER DEFAULT 1,
            sentAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customerId) REFERENCES customers(id)
          )
        `;
        
        db.run(sql, (err) => {
          if (err && !err.message.includes("already exists")) {
            return reject(err);
          }
          
          // Create indexes
          db.serialize(() => {
            db.run("CREATE INDEX IF NOT EXISTS idx_chat_workspace ON chat_messages(workspaceSlug)");
            db.run("CREATE INDEX IF NOT EXISTS idx_chat_customer ON chat_messages(customerId)");
            db.run("CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(sessionId)");
            db.run("CREATE INDEX IF NOT EXISTS idx_chat_visible ON chat_messages(isVisible)");
            db.run("CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(conversationId)");
            db.run("CREATE INDEX IF NOT EXISTS idx_chat_sent_at ON chat_messages(sentAt)", (indexErr) => {
              if (indexErr && !indexErr.message.includes("already exists")) {
                return reject(indexErr);
              }
              resolve();
            });
          });
        });
      });
    }
  }
]

// Create migrations tracking table
function ensureMigrationsTable(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

// Get current migration version
function getCurrentVersion(db: sqlite3.Database): Promise<number> {
  return new Promise((resolve, reject) => {
    db.get("SELECT MAX(version) as version FROM schema_migrations", (err, row: any) => {
      if (err) return reject(err)
      resolve(row?.version || 0)
    })
  })
}

// Record migration
function recordMigration(db: sqlite3.Database, version: number, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(
      "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
      [version, name],
      (err) => {
        if (err) return reject(err)
        resolve()
      }
    )
  })
}

// Run pending migrations
export async function runMigrations(db: sqlite3.Database): Promise<void> {
  try {
    await ensureMigrationsTable(db)
    const currentVersion = await getCurrentVersion(db)
    
    const pendingMigrations = migrations.filter(m => m.version > currentVersion)
    
    if (pendingMigrations.length === 0) {
      console.log('[MIGRATIONS] Database is up to date')
      return
    }
    
    console.log(`[MIGRATIONS] Running ${pendingMigrations.length} pending migration(s)`)
    
    for (const migration of pendingMigrations) {
      console.log(`[MIGRATIONS] Applying migration ${migration.version}: ${migration.name}`)
      try {
        await migration.up(db)
        await recordMigration(db, migration.version, migration.name)
        console.log(`[MIGRATIONS] ✓ Migration ${migration.version} applied successfully`)
      } catch (err) {
        console.error(`[MIGRATIONS] ✗ Migration ${migration.version} failed:`, err)
        throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${err}`)
      }
    }
    
    console.log('[MIGRATIONS] All migrations completed successfully')
  } catch (err) {
    console.error('[MIGRATIONS] Migration process failed:', err)
    throw err
  }
}

// Get migration status (for diagnostic endpoints)
export async function getMigrationStatus(db: sqlite3.Database): Promise<{
  currentVersion: number
  latestVersion: number
  appliedMigrations: Array<{ version: number; name: string; applied_at: string }>
  pendingMigrations: Array<{ version: number; name: string }>
}> {
  await ensureMigrationsTable(db)
  
  const currentVersion = await getCurrentVersion(db)
  const latestVersion = migrations.length > 0 ? Math.max(...migrations.map(m => m.version)) : 0
  
  const appliedMigrations = await new Promise<any[]>((resolve, reject) => {
    db.all(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
      (err, rows) => {
        if (err) return reject(err)
        resolve(rows || [])
      }
    )
  })
  
  const pendingMigrations = migrations
    .filter(m => m.version > currentVersion)
    .map(m => ({ version: m.version, name: m.name }))
  
  return {
    currentVersion,
    latestVersion,
    appliedMigrations,
    pendingMigrations
  }
}
