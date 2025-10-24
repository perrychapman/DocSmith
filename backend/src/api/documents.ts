// backend/src/api/documents.ts
import { Router } from "express"
import { getDB } from "../services/storage"
import { resolveCustomerPaths } from "../services/customerLibrary"
import { customerPaths } from "../services/fs"
import { getExcelSheetCount } from "../services/fileAnalyzer"
import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { secureFileValidation } from "../services/fileSecurityValidator"

const router = Router()

// Sidecar utilities (matching uploads.ts)
interface Sidecar {
  docName: string
  docId?: string
  workspaceSlug?: string
  uploadedAt: string
  excelFolder?: string
}

function sidecarPath(uploadsDir: string, filename: string) {
  return path.join(uploadsDir, `${filename}.allm.json`)
}

function writeSidecar(uploadsDir: string, filename: string, data: Sidecar) {
  try { fs.writeFileSync(sidecarPath(uploadsDir, filename), JSON.stringify(data, null, 2), "utf-8") } catch {}
}


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

// POST /api/documents/:customerId/embed-generated — copy a generated document to uploads folder and embed in workspace
router.post("/:customerId/embed-generated", (req, res) => {
  const customerId = Number(req.params.customerId)
  const fileName = (req.body as any)?.filename ? String((req.body as any).filename) : undefined
  
  if (!customerId || !fileName) {
    return res.status(400).json({ error: "customerId and filename are required" })
  }

  const db = getDB()
  db.get<{ id: number; name: string; createdAt: string; workspaceSlug?: string | null }>(
    "SELECT id, name, createdAt, workspaceSlug FROM customers WHERE id = ?",
    [customerId],
    async (err, row) => {
      if (err) return res.status(500).json({ error: err.message })
      if (!row) return res.status(404).json({ error: "Customer not found" })

      const { documentsDir } = customerPaths(row.id, row.name, new Date(row.createdAt))
      const { uploadsDir } = resolveCustomerPaths(row.id, row.name, new Date(row.createdAt))
      
      const sourcePath = path.join(documentsDir, fileName)
      const destPath = path.join(uploadsDir, fileName)

      // Check if source file exists
      if (!fs.existsSync(sourcePath)) {
        return res.status(404).json({ error: "Generated document not found" })
      }

      // Check if destination already exists
      if (fs.existsSync(destPath)) {
        return res.status(400).json({ error: "A document with this name already exists in uploads" })
      }

      try {
        // Ensure uploads directory exists
        fs.mkdirSync(uploadsDir, { recursive: true })
        
        // Copy the file to uploads folder
        console.log(`[EMBED-GEN] Copying "${sourcePath}" to "${destPath}"`)
        fs.copyFileSync(sourcePath, destPath)
        console.log(`[EMBED-GEN] File copied successfully`)

        // If customer has a workspace, embed the document
        const slug = row.workspaceSlug
        if (slug) {
          try {
            // Import anythingllm functions
            const { anythingllmRequest } = await import("../services/anythingllm")
            const { folderNameForCustomer } = await import("../services/customerLibrary")
            
            // Step 1: Ensure the customer folder exists in AnythingLLM
            const folderName = folderNameForCustomer(row.id, row.name, new Date(row.createdAt))
            console.log(`[EMBED-GEN] Ensuring folder exists: "${folderName}"`)
            
            try {
              await anythingllmRequest<{ success: boolean; message: string | null }>(
                "/document/create-folder",
                "POST",
                { name: folderName }
              )
              console.log(`[EMBED-GEN] Folder created or already exists`)
            } catch (folderErr) {
              console.log(`[EMBED-GEN] Folder creation response:`, folderErr)
            }
            
            // Step 2: Upload to AnythingLLM
            const fd = new FormData()
            const buf = fs.readFileSync(destPath)
            const uint = new Uint8Array(buf)
            // @ts-ignore File is available in Node 18+
            const theFile = new File([uint], fileName)
            fd.append("file", theFile)
            
            console.log(`[EMBED-GEN] Uploading file "${fileName}" to AnythingLLM...`)
            const resp = await anythingllmRequest<any>(
              `/document/upload`,
              "POST",
              fd
            )
            
            console.log(`[EMBED-GEN] Upload response:`, JSON.stringify(resp, null, 2))
            
            // Extract ALL uploaded document names from response (important for Excel files with multiple sheets)
            let uploadedDocNames: string[] = []
            try {
              const docs = Array.isArray(resp?.documents) ? resp.documents : []
              console.log(`[EMBED-GEN] Found ${docs.length} documents in upload response`)
              
              for (const doc of docs) {
                if (doc?.location) {
                  const fullPath = String(doc.location).trim()
                  const match = fullPath.match(/[A-Z]:[/\\].*[/\\]documents[/\\](.+)$/i) || 
                                fullPath.match(/^[/\\].*[/\\]documents[/\\](.+)$/i)
                  
                  if (match && match[1]) {
                    uploadedDocNames.push(match[1].replace(/\\/g, '/'))
                  } else {
                    uploadedDocNames.push(fullPath.replace(/\\/g, '/'))
                  }
                }
              }
              
              console.log(`[EMBED-GEN] Extracted ${uploadedDocNames.length} document path(s):`, uploadedDocNames)
            } catch (e) {
              console.error(`[EMBED-GEN] Error parsing upload response:`, e)
            }
            
            if (uploadedDocNames.length === 0) {
              throw new Error(`Failed to get document names from upload response`)
            }

            // Step 3: Move ALL documents to customer folder (important for Excel sheets)
            console.log(`[EMBED-GEN] Moving ${uploadedDocNames.length} document(s) to customer folder "${folderName}"`)
            const movedPaths: string[] = []
            
            for (const uploadedDocName of uploadedDocNames) {
              const sourceFilename = uploadedDocName.split('/').pop() || uploadedDocName
              const targetPath = `${folderName}/${sourceFilename}`
              console.log(`[EMBED-GEN] Moving: "${uploadedDocName}" -> "${targetPath}"`)
              
              try {
                const moveResp = await anythingllmRequest<any>(
                  "/document/move-files",
                  "POST",
                  { files: [{ from: uploadedDocName, to: targetPath }] }
                )
                
                if (moveResp?.success !== false) {
                  movedPaths.push(targetPath)
                  console.log(`[EMBED-GEN] ✓ Moved successfully`)
                } else {
                  console.log(`[EMBED-GEN] Move failed: ${moveResp?.message}`)
                  movedPaths.push(uploadedDocName) // Use original path as fallback
                }
              } catch (moveErr) {
                console.error(`[EMBED-GEN] Move error:`, moveErr)
                movedPaths.push(uploadedDocName) // Use original path as fallback
              }
            }
            
            console.log(`[EMBED-GEN] Successfully moved/prepared ${movedPaths.length} document(s)`)
            
            // Check if this is an Excel file
            const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls')
            
            // For Excel files, wait briefly for AnythingLLM to process
            if (isExcel) {
              console.log(`[EMBED-GEN] Excel file detected with ${movedPaths.length} sheets, waiting 3s for processing...`)
              await new Promise(resolve => setTimeout(resolve, 3000))
            }

            // Step 4: Prepare documents to embed
            const docsToEmbed = movedPaths
            console.log(`[EMBED-GEN] Will embed ${docsToEmbed.length} document(s)`)

            // Step 5: Embed ALL documents into the workspace with retry logic
            console.log(`[EMBED-GEN] Embedding ${docsToEmbed.length} document(s) into workspace "${slug}"`)
            console.log(`[EMBED-GEN] Documents to embed:`, JSON.stringify(docsToEmbed, null, 2))
            let embedSucceeded = false
            const maxEmbedRetries = 3
            
            for (let attempt = 1; attempt <= maxEmbedRetries; attempt++) {
              try {
                console.log(`[EMBED-GEN] Embedding attempt ${attempt}/${maxEmbedRetries}`)
                const embedPayload = { adds: docsToEmbed }
                console.log(`[EMBED-GEN] Embedding payload:`, JSON.stringify(embedPayload, null, 2))
                
                const embedResp = await anythingllmRequest<any>(
                  `/workspace/${encodeURIComponent(slug)}/update-embeddings`,
                  "POST",
                  embedPayload // Embed all documents (all sheets for Excel files)
                )
                console.log(`[EMBED-GEN] Embedding response:`, JSON.stringify(embedResp, null, 2))
                
                // Check if embedding succeeded
                const msg = embedResp?.message || ''
                if (embedResp && !msg.toLowerCase().includes('error') && !msg.toLowerCase().includes('failed')) {
                  console.log(`[EMBED-GEN] ✓ Successfully embedded ${docsToEmbed.length} document(s) into workspace on attempt ${attempt}`)
                  embedSucceeded = true
                  break
                } else {
                  console.log(`[EMBED-GEN] Embedding response indicates potential failure, retrying...`)
                  if (attempt < maxEmbedRetries) {
                    await new Promise(resolve => setTimeout(resolve, 3000))
                  }
                }
              } catch (embedErr) {
                console.error(`[EMBED-GEN] Embedding attempt ${attempt} failed:`, embedErr)
                console.error(`[EMBED-GEN] Attempted to embed documents:`, docsToEmbed)
                console.error(`[EMBED-GEN] Workspace slug: "${slug}"`)
                if (attempt < maxEmbedRetries) {
                  console.log(`[EMBED-GEN] Retrying embedding in 3s...`)
                  await new Promise(resolve => setTimeout(resolve, 3000))
                }
              }
            }
            
            if (!embedSucceeded) {
              console.error(`[EMBED-GEN] Failed to embed document after ${maxEmbedRetries} attempts`)
              // File was copied successfully, but embedding failed
              return res.status(200).json({
                ok: true,
                filename: fileName,
                embeddingWarning: 'Document copied but embedding failed after 3 attempts'
              })
            }
            
            // Step 6: Save sidecar mapping (matching upload behavior)
            try {
              const firstDocPath = docsToEmbed[0]
              let docId: string | undefined
              try {
                const one = await anythingllmRequest<any>(`/document/${encodeURIComponent(firstDocPath)}`, "GET")
                const items = Array.isArray(one?.localFiles?.items) ? one.localFiles.items : []
                const match = items.find((x: any) => (String(x?.name || "") === firstDocPath))
                if (match?.id) docId = String(match.id)
              } catch {}
              
              // For Excel files, store the original folder name (before moving to customer folder)
              // This is needed for cleanup when deleting
              let excelFolder: string | undefined
              if (isExcel && uploadedDocNames.length > 0) {
                // Extract folder name from original upload path
                // Format: "custom-documents/filename.xlsx-XXXX/sheet-Name.json"
                const folderMatch = uploadedDocNames[0].match(/([^\/]+\.xlsx?-[a-f0-9]+)\//i)
                if (folderMatch) {
                  excelFolder = folderMatch[1]
                  console.log(`[EMBED-GEN] Storing Excel folder name in sidecar: "${excelFolder}"`)
                }
              }
              
              writeSidecar(uploadsDir, fileName, { 
                docName: firstDocPath, 
                docId, 
                workspaceSlug: slug, 
                uploadedAt: new Date().toISOString(),
                ...(excelFolder ? { excelFolder } : {})
              })
              console.log(`[EMBED-GEN] ✓ Sidecar mapping saved`)
            } catch (sidecarErr) {
              console.error(`[EMBED-GEN] Failed to write sidecar:`, sidecarErr)
              // Don't fail the request if sidecar fails
            }
            
            // Step 7: Mark document as generated in metadata
            console.log(`[EMBED-GEN] Marking document as generated in metadata`)
            try {
              const { saveDocumentMetadata } = await import("../services/documentMetadata")
              await saveDocumentMetadata(customerId, {
                customerId,
                filename: fileName,
                anythingllmPath: docsToEmbed[0], // Use first document path for metadata
                uploadedAt: new Date().toISOString(),
                fileSize: fs.statSync(destPath).size,
                extraFields: {
                  isGenerated: true,
                  originalLocation: 'documents',
                  movedToWorkspaceAt: new Date().toISOString()
                }
              }, slug)
              console.log(`[EMBED-GEN] ✓ Metadata saved with generated flag`)
            } catch (metaErr) {
              console.error(`[EMBED-GEN] Failed to save metadata:`, metaErr)
              // Don't fail the request if metadata fails
            }
            
            return res.status(200).json({ 
              ok: true, 
              filename: fileName,
              message: 'Document copied and embedded successfully'
            })
          } catch (embedErr) {
            console.error(`[EMBED-GEN] Embedding failed:`, embedErr)
            // File was copied successfully, but embedding failed
            return res.status(200).json({
              ok: true,
              filename: fileName,
              embeddingWarning: `Document copied but embedding failed: ${(embedErr as Error).message}`
            })
          }
        } else {
          // No workspace, just copy the file
          return res.status(200).json({ 
            ok: true, 
            filename: fileName,
            message: 'Document copied successfully (no workspace to embed)'
          })
        }
      } catch (error) {
        console.error(`[EMBED-GEN] Failed to copy/embed document:`, error)
        return res.status(500).json({ error: `Failed to copy document: ${(error as Error).message}` })
      }
    }
  )
})

export default router

