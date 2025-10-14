// backend/src/api/uploads.ts
import { Router } from "express"
import path from "path"
import fs from "fs"
import { spawn } from "child_process"
import type { Request } from "express"
import { getDB } from "../services/storage"
import { ensureUploadsDir, resolveCustomerPaths, folderNameForCustomer } from "../services/customerLibrary"
import { anythingllmRequest } from "../services/anythingllm"
import { findDocsByFilename, documentExists, qualifiedNamesForShort } from "../services/anythingllmDocs"
import { secureFileValidation } from "../services/fileSecurityValidator"
import { analyzeDocumentMetadata, saveDocumentMetadata, loadDocumentMetadata, deleteDocumentMetadata, generateWorkspaceIndex, refreshWorkspaceIndex } from "../services/documentMetadata"

// Lazy import multer to avoid types requirement at compile time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require("multer")

const router = Router()

type CustomerRow = { id: number; name: string; workspaceSlug?: string | null; createdAt: string }

// In-memory notification store for metadata extraction events
type MetadataNotification = {
  customerId: number
  filename: string
  status: 'processing' | 'complete' | 'error'
  message?: string
  metadata?: any
  timestamp: number
}

const metadataNotifications: MetadataNotification[] = []
const MAX_NOTIFICATIONS = 100
const DEDUP_WINDOW_MS = 2000 // 2 seconds

function addNotification(notification: MetadataNotification) {
  // Prevent duplicate notifications for same file within short time window
  const recent = metadataNotifications.find(
    n => n.customerId === notification.customerId &&
         n.filename === notification.filename &&
         n.status === notification.status &&
         (Date.now() - n.timestamp) < DEDUP_WINDOW_MS
  )
  
  if (recent) {
    console.log(`[METADATA-NOTIF] Skipping duplicate ${notification.status} notification for ${notification.filename} (within ${DEDUP_WINDOW_MS}ms window)`)
    return
  }
  
  metadataNotifications.unshift(notification)
  if (metadataNotifications.length > MAX_NOTIFICATIONS) {
    metadataNotifications.pop()
  }
}

/**
 * Extracts document metadata in the background after successful upload
 * This runs asynchronously and doesn't block the upload response
 */
async function extractMetadataInBackground(
  customerId: number,
  filePath: string,
  filename: string,
  workspaceSlug: string,
  documentName?: string
): Promise<void> {
  // Notify: processing started
  addNotification({
    customerId,
    filename,
    status: 'processing',
    message: 'Analyzing document metadata...',
    timestamp: Date.now()
  })
  
  try {
    const targetDoc = documentName || filename
    console.log(`[METADATA] Starting background extraction for ${filename}`)
    console.log(`[METADATA] Workspace: ${workspaceSlug}`)
    console.log(`[METADATA] Target document name: "${targetDoc}"`)
    
    // Wait for AnythingLLM to finish indexing the document with retries
    // Production builds may take longer than dev mode
    const maxWaitTime = 30000 // 30 seconds max
    const checkInterval = 2000 // Check every 2 seconds
    const startTime = Date.now()
    let isIndexed = false
    
    console.log(`[METADATA] Waiting for document to be indexed (max ${maxWaitTime/1000}s)...`)
    
    while (!isIndexed && (Date.now() - startTime) < maxWaitTime) {
      try {
        // Check if document exists in workspace embeddings
        const workspaceInfo = await anythingllmRequest<any>(
          `/workspace/${encodeURIComponent(workspaceSlug)}`,
          'GET'
        )
        
        const documents = workspaceInfo?.workspace?.documents || []
        const foundDoc = documents.find((d: any) => 
          d.docpath === targetDoc || 
          d.name === targetDoc ||
          d.location === targetDoc
        )
        
        if (foundDoc) {
          console.log(`[METADATA] Document indexed successfully after ${((Date.now() - startTime)/1000).toFixed(1)}s`)
          isIndexed = true
          break
        }
        
        console.log(`[METADATA] Document not yet indexed, waiting ${checkInterval/1000}s... (${((Date.now() - startTime)/1000).toFixed(1)}s elapsed)`)
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      } catch (err) {
        console.error(`[METADATA] Error checking indexing status:`, err)
        // Continue waiting - might just be a transient error
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }
    
    if (!isIndexed) {
      console.log(`[METADATA] Document not indexed after ${maxWaitTime/1000}s, proceeding anyway (might be slow indexing)`)
      // Proceed anyway - the document might still be queryable even if not showing in workspace.documents yet
    }
    
    // Retry logic for metadata analysis (sometimes first attempt fails if document still indexing)
    console.log(`[METADATA] Sending AI analysis request for "${targetDoc}"`)
    let metadata: any = null
    let lastError: Error | null = null
    const maxRetries = 3
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[METADATA] Analysis attempt ${attempt}/${maxRetries}`)
        metadata = await analyzeDocumentMetadata(filePath, filename, workspaceSlug, documentName, documentName)
        
        // Check if we got meaningful metadata (not just fallback)
        if (metadata.documentType || metadata.purpose || (metadata.keyTopics && metadata.keyTopics.length > 0)) {
          console.log(`[METADATA] Analysis successful on attempt ${attempt}`)
          break
        } else {
          console.log(`[METADATA] Got fallback metadata on attempt ${attempt}, retrying...`)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 3000)) // Wait 3s before retry
          }
        }
      } catch (err) {
        lastError = err as Error
        console.error(`[METADATA] Analysis attempt ${attempt} failed:`, err)
        if (attempt < maxRetries) {
          console.log(`[METADATA] Retrying in 3s...`)
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
      }
    }
    
    if (!metadata || (!metadata.documentType && !metadata.purpose)) {
      throw new Error(`Failed to extract metadata after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`)
    }
    
    console.log(`[METADATA] Analysis complete for ${filename}:`, {
      type: metadata.documentType,
      topics: metadata.keyTopics?.length,
      stakeholders: metadata.stakeholders?.length
    })
    
    metadata.customerId = customerId
    await saveDocumentMetadata(customerId, metadata, workspaceSlug)
    
    console.log(`[METADATA] Metadata saved to database for ${filename}`)
    
    // Refresh workspace index with new document metadata
    console.log(`[METADATA] Refreshing workspace index...`)
    await refreshWorkspaceIndex(customerId, workspaceSlug)
    
    // Give SQLite a moment to commit the transaction before notifying frontend
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Notify: success
    addNotification({
      customerId,
      filename,
      status: 'complete',
      message: `Metadata extracted successfully for ${filename}`,
      metadata: {
        documentType: metadata.documentType,
        keyTopicsCount: metadata.keyTopics?.length || 0,
        stakeholdersCount: metadata.stakeholders?.length || 0
      },
      timestamp: Date.now()
    })
  } catch (err) {
    console.error(`[METADATA] Background extraction failed for ${filename}:`, err)
    
    // Notify: error
    addNotification({
      customerId,
      filename,
      status: 'error',
      message: `Failed to extract metadata: ${(err as Error).message}`,
      timestamp: Date.now()
    })
    
    throw err
  }
}

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

function openInDefaultApp(targetPath: string): boolean {
  if (!targetPath) return false
  const platform = process.platform
  try {
    if (platform === 'win32') {
      // Use proper Windows start command syntax
      // The empty string "" is the window title, then we pass the file path
      // Using /B to not create a new console window
      const child = spawn('cmd', ['/c', 'start', '/B', '""', targetPath], { 
        detached: true, 
        stdio: 'ignore',
        shell: true 
      })
      child.unref()
    } else if (platform === 'darwin') {
      const child = spawn('open', [targetPath], { detached: true, stdio: 'ignore' })
      child.unref()
    } else {
      const child = spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' })
      child.unref()
    }
    return true
  } catch {
    return false
  }
}

// POST /api/uploads/:customerId/metadata-extract -> manually trigger metadata extraction for a specific file
router.post("/:customerId/metadata-extract", (req, res) => {
  const id = Number(req.params.customerId)
  const { filename } = req.body
  
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })
  if (!filename || typeof filename !== 'string') return res.status(400).json({ error: "Missing filename" })
  
  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })
      if (!row.workspaceSlug) return res.status(400).json({ error: "Customer has no workspace configured" })
      
      try {
        const { uploadsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
        const filePath = path.join(uploadsDir, filename)
        
        // Verify file exists
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ error: "File not found" })
        }
        
        // Get document name from sidecar if available
        const sidecar = readSidecar(uploadsDir, filename)
        const documentName = sidecar?.docName || filename
        
        // Return immediately and process in background
        res.json({ ok: true, message: "Metadata extraction started" })
        
        // Start background extraction
        setImmediate(() => {
          extractMetadataInBackground(id, filePath, filename, row.workspaceSlug!, documentName)
            .catch(err => console.error('[METADATA-RETRY] Failed:', err))
        })
      } catch (err) {
        return res.status(500).json({ error: (err as Error).message })
      }
    }
  )
})

// GET /api/uploads/metadata-notifications/:customerId -> get recent metadata extraction notifications
router.get("/metadata-notifications/:customerId", (req, res) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })
  
  const customerNotifications = metadataNotifications
    .filter(n => n.customerId === id)
    .slice(0, 20) // Last 20 notifications
  
  return res.json({ notifications: customerNotifications })
})

// GET /api/uploads/metadata-stream/:customerId -> Server-Sent Events stream for real-time notifications
router.get("/metadata-stream/:customerId", (req, res) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })
  
  // Optional: filename to track specifically (for initial connection)
  const trackFilename = req.query.filename ? String(req.query.filename) : null
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', customerId: id })}\n\n`)
  
  // If tracking a specific file, send any recent notification for it (within last 5 seconds)
  if (trackFilename) {
    const fiveSecondsAgo = Date.now() - 5000
    const recentNotification = metadataNotifications
      .filter(n => n.customerId === id && n.filename === trackFilename && n.timestamp > fiveSecondsAgo)
      .sort((a, b) => b.timestamp - a.timestamp)[0] // Get most recent
    
    if (recentNotification) {
      console.log(`[SSE] Sending recent notification for tracked file: ${trackFilename}`)
      res.write(`data: ${JSON.stringify({ type: 'notification', notification: recentNotification })}\n\n`)
    }
  }
  
  // Set lastCheck to NOW so we only get NEW notifications from this point forward
  let lastCheck = Date.now()
  console.log(`[SSE] New connection for customer ${id}, lastCheck set to ${lastCheck}`, trackFilename ? `tracking: ${trackFilename}` : '')
  
  // Check for new notifications every 2 seconds
  const interval = setInterval(() => {
    const newNotifications = metadataNotifications
      .filter(n => n.customerId === id && n.timestamp > lastCheck)
    
    if (newNotifications.length > 0) {
      console.log(`[SSE] Sending ${newNotifications.length} notifications for customer ${id}`)
      newNotifications.forEach(notification => {
        console.log(`[SSE] Notification: ${notification.filename} - ${notification.status}`)
        res.write(`data: ${JSON.stringify({ type: 'notification', notification })}\n\n`)
      })
      lastCheck = Date.now()
    }
  }, 2000)
  
  // Cleanup on client disconnect
  req.on('close', () => {
    console.log(`[SSE] Connection closed for customer ${id}`)
    clearInterval(interval)
    res.end()
  })
})

// GET /api/uploads/:customerId/metadata?name=<filename> -> get metadata for a specific file
router.get("/:customerId/metadata", async (req, res) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })
  
  const filename = req.query.name ? String(req.query.name) : null
  if (!filename) return res.status(400).json({ error: "Missing filename query parameter" })
  
  try {
    const metadata = await loadDocumentMetadata(id, filename)
    
    if (!metadata) {
      return res.status(404).json({ 
        error: "Metadata not found",
        message: `No metadata found for ${filename}. It may not have been analyzed yet.`
      })
    }
    
    res.json({ metadata })
  } catch (err) {
    console.error(`[METADATA] Failed to load metadata for ${filename}:`, err)
    res.status(500).json({ 
      error: "Failed to load metadata",
      message: err instanceof Error ? err.message : String(err)
    })
  }
})

// GET /api/uploads/:customerId -> list files in uploads folder
router.get("/:customerId", async (req, res) => {
  const id = Number(req.params.customerId)
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid customerId" })

  const db = getDB()
  db.get<CustomerRow>(
    "SELECT id, name, workspaceSlug, createdAt FROM customers WHERE id = ?",
    [id],
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })
      try {
        const { uploadsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
        fs.mkdirSync(uploadsDir, { recursive: true })
        const entries = fs
          .readdirSync(uploadsDir, { withFileTypes: true })
          .filter((e) => e.isFile() && !e.name.endsWith('.allm.json') && !e.name.endsWith('.metadata.json'))
        
        const items = await Promise.all(entries.map(async (e) => {
          const full = path.join(uploadsDir, e.name)
          const stat = fs.statSync(full)
          const sidecar = readSidecar(uploadsDir, e.name)
          const metadata = await loadDocumentMetadata(id, e.name)
          return {
            name: e.name,
            path: full,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            sidecar,
            metadata
          }
        }))
        
        items.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
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

// POST /api/uploads/:customerId/open-file -> return file metadata for client-side opening (consistent with documents endpoint)
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
        // Return path and extension for client-side opening (Electron will use shell.openPath)
        return res.json({ ok: true, path: safeTarget, extension: path.extname(safeTarget) })
      } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
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
                // Step 1: Ensure the customer folder exists in AnythingLLM
                const folderName = folderNameForCustomer(row.id, row.name, new Date(row.createdAt))
                console.log(`[UPLOAD] Ensuring folder exists: "${folderName}"`)
                
                try {
                  await anythingllmRequest<{ success: boolean; message: string | null }>(
                    "/document/create-folder",
                    "POST",
                    { name: folderName }
                  )
                  console.log(`[UPLOAD] Folder created or already exists`)
                } catch (folderErr) {
                  // Folder might already exist, which is fine
                  console.log(`[UPLOAD] Folder creation response:`, folderErr)
                }
                
                // Step 2: Upload to AnythingLLM (root location first)
                const fd = new FormData()
                const buf = fs.readFileSync(file.path)
                const uint = new Uint8Array(buf)
                // @ts-ignore File is available in Node 18+
                const theFile = new File([uint], file.filename)
                fd.append("file", theFile)
                
                console.log(`[UPLOAD] Uploading file "${file.filename}" to AnythingLLM...`)
                const resp = await anythingllmRequest<any>(
                  `/document/upload`,
                  "POST",
                  fd
                )
                
                console.log(`[UPLOAD] Upload response:`, JSON.stringify(resp, null, 2))
                
                // Extract uploaded document name from response
                let uploadedDocName: string | undefined
                try {
                  const docs = Array.isArray(resp?.documents) ? resp.documents : []
                  const first = docs[0]
                  if (first?.location) {
                    const fullPath = String(first.location)
                    // Extract relative path from full filesystem path
                    // e.g., "C:\...\storage\documents\custom-documents\file.csv-hash.json" 
                    // becomes "custom-documents/file.csv-hash.json"
                    const match = fullPath.match(/documents[/\\](.+)$/i)
                    if (match && match[1]) {
                      uploadedDocName = match[1].replace(/\\/g, '/') // Normalize to forward slashes
                    } else {
                      uploadedDocName = fullPath
                    }
                  } else if (first?.name) {
                    uploadedDocName = String(first.name)
                  }
                  console.log(`[UPLOAD] Uploaded document name: "${uploadedDocName}"`)
                } catch (e) {
                  console.error(`[UPLOAD] Error parsing upload response:`, e)
                }
                
                if (!uploadedDocName) {
                  throw new Error(`Failed to get document name from upload response`)
                }

                // Step 3: Move the file to the customer folder with retry logic
                // Keep the same filename with hash, just change the folder
                // e.g., "custom-documents/file.csv-hash.json" -> "Taylor-C_Oct_2025/file.csv-hash.json"
                const sourceFilename = uploadedDocName.split('/').pop() || uploadedDocName
                const targetPath = `${folderName}/${sourceFilename}`
                console.log(`[UPLOAD] Moving document from "${uploadedDocName}" to "${targetPath}"`)
                
                let moveSucceeded = false
                const maxMoveRetries = 3
                
                for (let attempt = 1; attempt <= maxMoveRetries; attempt++) {
                  try {
                    console.log(`[UPLOAD] Move attempt ${attempt}/${maxMoveRetries}`)
                    const moveResp = await anythingllmRequest<{ success: boolean; message: string | null }>(
                      "/document/move-files",
                      "POST",
                      { files: [{ from: uploadedDocName, to: targetPath }] }
                    )
                    console.log(`[UPLOAD] Move response:`, moveResp)
                    
                    if (moveResp?.success !== false) {
                      console.log(`[UPLOAD] File moved successfully to customer folder on attempt ${attempt}`)
                      moveSucceeded = true
                      break
                    } else {
                      console.log(`[UPLOAD] Move returned success=false, retrying...`)
                      if (attempt < maxMoveRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000))
                      }
                    }
                  } catch (moveErr) {
                    console.error(`[UPLOAD] Move attempt ${attempt} failed:`, moveErr)
                    if (attempt < maxMoveRetries) {
                      console.log(`[UPLOAD] Retrying move in 2s...`)
                      await new Promise(resolve => setTimeout(resolve, 2000))
                    }
                  }
                }
                
                if (!moveSucceeded) {
                  console.error(`[UPLOAD] Failed to move file after ${maxMoveRetries} attempts - document will remain in ${uploadedDocName}`)
                  // Fall back to using the original uploaded path
                }

                // After moving, the document path is now targetPath (or original if move failed)
                const docName = moveSucceeded ? targetPath : uploadedDocName
                console.log(`[UPLOAD] Document final path: "${docName}"`)

                // Step 4: Verify document exists in AnythingLLM before embedding
                console.log(`[UPLOAD] Verifying document exists in AnythingLLM...`)
                const verifyMaxTime = 20000 // 20 seconds max
                const verifyInterval = 2000 // Check every 2 seconds
                const verifyStartTime = Date.now()
                let documentExists = false
                
                while (!documentExists && (Date.now() - verifyStartTime) < verifyMaxTime) {
                  try {
                    const docsListResp = await anythingllmRequest<any>('/documents', 'GET')
                    const allDocs = docsListResp?.localFiles || []
                    const foundDoc = allDocs.find((d: any) => 
                      d.name === docName || 
                      d.location?.includes(sourceFilename) ||
                      d.name?.includes(sourceFilename)
                    )
                    
                    if (foundDoc) {
                      console.log(`[UPLOAD] Document verified in AnythingLLM after ${((Date.now() - verifyStartTime)/1000).toFixed(1)}s`)
                      documentExists = true
                      break
                    }
                    
                    console.log(`[UPLOAD] Document not yet visible, waiting ${verifyInterval/1000}s... (${((Date.now() - verifyStartTime)/1000).toFixed(1)}s elapsed)`)
                    await new Promise(resolve => setTimeout(resolve, verifyInterval))
                  } catch (err) {
                    console.error(`[UPLOAD] Error verifying document:`, err)
                    await new Promise(resolve => setTimeout(resolve, verifyInterval))
                  }
                }
                
                if (!documentExists) {
                  console.log(`[UPLOAD] Document not verified after ${verifyMaxTime/1000}s, proceeding anyway`)
                }
                
                // Save sidecar mapping
                try {
                  let docId: string | undefined
                  try {
                    const one = await anythingllmRequest<any>(`/document/${encodeURIComponent(docName)}`, "GET")
                    const items = Array.isArray(one?.localFiles?.items) ? one.localFiles.items : []
                    const match = items.find((x: any) => (String(x?.name || "") === docName))
                    if (match?.id) docId = String(match.id)
                  } catch {}
                  writeSidecar(uploadsDir, file.filename, { docName, docId, workspaceSlug: slug, uploadedAt: new Date().toISOString() })
                } catch {}
                
                // Step 5: Embed the uploaded document into the workspace with retry logic
                console.log(`[UPLOAD] Embedding document "${docName}" into workspace "${slug}"`)
                let embedSucceeded = false
                const maxEmbedRetries = 3
                
                for (let attempt = 1; attempt <= maxEmbedRetries; attempt++) {
                  try {
                    console.log(`[UPLOAD] Embedding attempt ${attempt}/${maxEmbedRetries}`)
                    const embedResp = await anythingllmRequest<any>(
                      `/workspace/${encodeURIComponent(slug)}/update-embeddings`,
                      "POST",
                      { adds: [docName] }
                    )
                    console.log(`[UPLOAD] Embedding response:`, embedResp)
                    
                    // Check if embedding succeeded
                    const msg = embedResp?.message || ''
                    if (embedResp && !msg.toLowerCase().includes('error') && !msg.toLowerCase().includes('failed')) {
                      console.log(`[UPLOAD] Successfully embedded document into workspace on attempt ${attempt}`)
                      embedSucceeded = true
                      break
                    } else {
                      console.log(`[UPLOAD] Embedding response indicates potential failure, retrying...`)
                      if (attempt < maxEmbedRetries) {
                        await new Promise(resolve => setTimeout(resolve, 3000))
                      }
                    }
                  } catch (embedErr) {
                    console.error(`[UPLOAD] Embedding attempt ${attempt} failed:`, embedErr)
                    console.error(`[UPLOAD] Attempted to embed document path: "${docName}"`)
                    console.error(`[UPLOAD] Workspace slug: "${slug}"`)
                    if (attempt < maxEmbedRetries) {
                      console.log(`[UPLOAD] Retrying embedding in 3s...`)
                      await new Promise(resolve => setTimeout(resolve, 3000))
                    }
                  }
                }
                
                if (!embedSucceeded) {
                  console.error(`[UPLOAD] Failed to embed document after ${maxEmbedRetries} attempts`)
                  // Continue anyway - document is uploaded and moved, can be embedded manually later
                }

                // Kick off metadata extraction in background (non-blocking)
                // Don't await - let it run asynchronously after upload completes
                console.log(`[UPLOAD] Kicking off background metadata extraction`)
                console.log(`[UPLOAD] Will analyze document: "${docName || file.filename}"`)
                setImmediate(() => {
                  extractMetadataInBackground(id, file.path, file.filename, slug, docName)
                    .catch(err => console.error('[METADATA] Background extraction failed:', err))
                })
                
                return res.status(201).json({ ok: true, file: { name: file.filename, path: file.path } })
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
        if (fs.existsSync(safeTarget)) { 
          fs.unlinkSync(safeTarget)
          removedLocal = true
          
          // Delete metadata from database
          try {
            await deleteDocumentMetadata(id, name)
          } catch (metaErr) {
            console.error("Failed to delete metadata:", metaErr)
            // Non-blocking - document was still deleted
          }
        }
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
              
              // Refresh workspace index after document deletion
              try {
                console.log(`[DELETE] Refreshing workspace index after removing ${name}...`)
                await refreshWorkspaceIndex(id, String(slug))
              } catch (indexErr) {
                console.error(`[DELETE] Failed to refresh workspace index:`, indexErr)
                // Non-blocking - document was still deleted
              }
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

