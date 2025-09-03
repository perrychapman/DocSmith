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
  const { uploadsDir } = resolveCustomerPaths(customer.id, customer.name, new Date(customer.createdAt))
  const slug = customer.workspaceSlug ? String(customer.workspaceSlug) : undefined
  const target = path.join(uploadsDir, filename)
  const safeBase = path.resolve(uploadsDir)
  const safeTarget = path.resolve(target)
  if (!safeTarget.startsWith(safeBase)) throw new Error("Invalid file path")

  // delete local file if present
  let removedLocal = false
  try { if (fs.existsSync(safeTarget)) { fs.unlinkSync(safeTarget); removedLocal = true } } catch {}

  const removedNames: string[] = []
  let documentsWarning: string | undefined
  if (slug) {
    try {
      // names via sidecar first
      let names: string[] = []
      const sc = readSidecar(uploadsDir, filename)
      if (sc?.docName) {
        try {
          const q = await qualifiedNamesForShort(sc.docName)
          names = q.length ? q : [sc.docName]
        } catch { names = [sc.docName] }
      }
      // find across global folders if still missing
      if (!names.length) {
        try { names = await findDocsByFilename(filename, slug) } catch {}
      }
      // fallback to workspace doc list match by title/chunkSource
      if (!names.length) {
        try {
          const ws = await anythingllmRequest<any>(`/workspace/${encodeURIComponent(slug)}`, "GET")
          const workspace = (ws as any)?.workspace ?? ws
          const docsArr: any[] = Array.isArray(workspace?.documents) ? workspace.documents : []
          const matches = docsArr.filter((d: any) => {
            const t = String(d?.title || "").trim()
            const c = String(d?.chunkSource || "").trim()
            return t === filename || c === filename
          })
          names = matches.map((d: any) => String(d?.name || d?.location || "")).filter(Boolean)
        } catch {}
      }
      // verify exist
      if (names.length) {
        const verified: string[] = []
        for (const n of names) { if (await documentExists(n)) verified.push(n) }
        names = verified
      }
      if (names.length) {
        for (const doc of names) {
          const success = await deleteDocByName(doc, slug)
          if (success) removedNames.push(doc)
        }
        // remove sidecar if everything removed
        if (removedNames.length === names.length) removeSidecar(uploadsDir, filename)
      }
    } catch (e) {
      documentsWarning = `Failed to remove AnythingLLM documents: ${(e as Error).message}`
    }
  }

  return { removedLocal, removedNames, ...(documentsWarning ? { documentsWarning } : {}) }
}

