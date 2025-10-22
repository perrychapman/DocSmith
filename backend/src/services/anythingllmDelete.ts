// backend/src/services/anythingllmDelete.ts
import fs from "fs"
import path from "path"
import { anythingllmRequest } from "./anythingllm"
import { findDocsByFilename, documentExists, qualifiedNamesForShort } from "./anythingllmDocs"
import { resolveCustomerPaths } from "./customerLibrary"

type CustomerInfo = { id: number; name: string; createdAt: string | Date; workspaceSlug?: string | null }

type Sidecar = { docName: string; docId?: string; workspaceSlug?: string; uploadedAt?: string }

function sidecarPath(uploadsDir: string, filename: string) {
  return path.join(uploadsDir, `${filename}.allm.json`)
}

function readSidecar(uploadsDir: string, filename: string): Sidecar | null {
  try {
    const p = sidecarPath(uploadsDir, filename)
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Sidecar
  } catch {
    return null
  }
}

function removeSidecar(uploadsDir: string, filename: string) {
  try {
    const p = sidecarPath(uploadsDir, filename)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch {}
}

async function deleteDocByName(doc: string, slug: string): Promise<boolean> {
  const wsPath = `/workspace/${encodeURIComponent(slug)}/update-embeddings`
  const sysPath = `/system/remove-documents`
  const qualified = doc
  const short = doc.includes('/') ? (doc.split('/').pop() as string) : doc
  const variants = Array.from(new Set([qualified, short]))
  let ok = false
  // attempt both variants
  for (const d of variants) { try { await anythingllmRequest(wsPath, "POST", { deletes: [d] }) } catch {} }
  for (const n of variants) { try { await anythingllmRequest(sysPath, "DELETE", { names: [n] }) ; ok = true } catch {} }
  const gone = !(await documentExists(doc))
  if (gone) return true
  // retry reverse order
  for (const n of variants) { try { await anythingllmRequest(sysPath, "DELETE", { names: [n] }) } catch {} }
  for (const d of variants) { try { await anythingllmRequest(wsPath, "POST", { deletes: [d] }) } catch {} }
  return !(await documentExists(doc))
}

export async function removeUploadAndAnythingLLM(customer: CustomerInfo, filename: string) {
  console.log(`[REMOVE-UPLOAD] Processing: ${filename}`)
  const { uploadsDir } = resolveCustomerPaths(customer.id, customer.name, new Date(customer.createdAt))
  const slug = customer.workspaceSlug ? String(customer.workspaceSlug) : undefined
  console.log(`[REMOVE-UPLOAD] Workspace slug: ${slug}`)
  const target = path.join(uploadsDir, filename)
  const safeBase = path.resolve(uploadsDir)
  const safeTarget = path.resolve(target)
  if (!safeTarget.startsWith(safeBase)) throw new Error("Invalid file path")

  // delete local file if present
  let removedLocal = false
  try { 
    if (fs.existsSync(safeTarget)) { 
      fs.unlinkSync(safeTarget); 
      removedLocal = true 
      console.log(`[REMOVE-UPLOAD] Deleted local file: ${filename}`)
    } else {
      console.log(`[REMOVE-UPLOAD] Local file not found: ${safeTarget}`)
    }
  } catch (e) {
    console.error(`[REMOVE-UPLOAD] Error deleting local file:`, e)
  }

  const removedNames: string[] = []
  let documentsWarning: string | undefined
  if (slug) {
    try {
      // names via sidecar first
      let names: string[] = []
      const sc = readSidecar(uploadsDir, filename)
      if (sc?.docName) {
        console.log(`[REMOVE-UPLOAD] Found sidecar with docName: ${sc.docName}`)
        try {
          const q = await qualifiedNamesForShort(sc.docName)
          names = q.length ? q : [sc.docName]
          console.log(`[REMOVE-UPLOAD] Qualified names from sidecar:`, names)
        } catch (e) { 
          console.log(`[REMOVE-UPLOAD] Error getting qualified names, using docName directly`)
          names = [sc.docName] 
        }
      } else {
        console.log(`[REMOVE-UPLOAD] No sidecar found for ${filename}`)
      }
      
      // find across global folders if still missing
      if (!names.length) {
        console.log(`[REMOVE-UPLOAD] Searching for document by filename...`)
        try { 
          names = await findDocsByFilename(filename, slug) 
          console.log(`[REMOVE-UPLOAD] Found by filename search:`, names)
        } catch (e) {
          console.log(`[REMOVE-UPLOAD] Filename search failed:`, e)
        }
      }
      
      // fallback to workspace doc list match by title/chunkSource
      if (!names.length) {
        console.log(`[REMOVE-UPLOAD] Searching workspace documents...`)
        try {
          const ws = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(slug)}`, "GET")
          const workspace = (ws as any)?.workspace ?? ws
          const docsArr: any[] = Array.isArray(workspace?.documents) ? workspace.documents : []
          console.log(`[REMOVE-UPLOAD] Workspace has ${docsArr.length} documents`)
          const matches = docsArr.filter((d: any) => {
            const t = String(d?.title || "").trim()
            const c = String(d?.chunkSource || "").trim()
            return t === filename || c === filename
          })
          console.log(`[REMOVE-UPLOAD] Found ${matches.length} matches by title/chunkSource`)
          names = matches.map((d: any) => String(d?.name || d?.location || "")).filter(Boolean)
          console.log(`[REMOVE-UPLOAD] Extracted names:`, names)
        } catch (e) {
          console.error(`[REMOVE-UPLOAD] Workspace search failed:`, e)
        }
      }
      
      // verify exist
      if (names.length) {
        console.log(`[REMOVE-UPLOAD] Verifying ${names.length} document(s) exist...`)
        const verified: string[] = []
        for (const n of names) { 
          const exists = await documentExists(n)
          console.log(`[REMOVE-UPLOAD] Document ${n} exists: ${exists}`)
          if (exists) verified.push(n) 
        }
        names = verified
        console.log(`[REMOVE-UPLOAD] ${names.length} document(s) verified to exist`)
      } else {
        console.log(`[REMOVE-UPLOAD] No documents found for ${filename}`)
      }
      
      if (names.length) {
        console.log(`[REMOVE-UPLOAD] Attempting to delete ${names.length} document(s)...`)
        for (const doc of names) {
          const success = await deleteDocByName(doc, slug)
          console.log(`[REMOVE-UPLOAD] Delete ${doc}: ${success ? 'SUCCESS' : 'FAILED'}`)
          if (success) removedNames.push(doc)
        }
        // remove sidecar if everything removed
        if (removedNames.length === names.length) {
          removeSidecar(uploadsDir, filename)
          console.log(`[REMOVE-UPLOAD] Removed sidecar for ${filename}`)
        }
      }
    } catch (e) {
      console.error(`[REMOVE-UPLOAD] Error during AnythingLLM removal:`, e)
      documentsWarning = `Failed to remove AnythingLLM documents: ${(e as Error).message}`
    }
  } else {
    console.log(`[REMOVE-UPLOAD] No workspace slug, skipping AnythingLLM deletion`)
  }

  console.log(`[REMOVE-UPLOAD] Complete: removedLocal=${removedLocal}, removedNames=${removedNames.length}`)
  return { removedLocal, removedNames, ...(documentsWarning ? { documentsWarning } : {}) }
}

