// backend/src/services/anythingllmDocs.ts
// Helpers for interacting with AnythingLLM documents index and lookups.

import { anythingllmRequest } from "./anythingllm"

export type AllmFileNode = {
  type: 'file'
  name: string
  id?: string
  url?: string
  title?: string
  pinnedWorkspaces?: string[]
  qualifiedName?: string
}

type AllmFolderNode = {
  type: 'folder'
  name: string
  items?: Array<AllmFolderNode | AllmFileNode>
}

type AllmDocumentsResp = {
  localFiles?: AllmFolderNode
}

function flatten(node: any, out: AllmFileNode[], prefix = "") {
  if (!node) return
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out, prefix)); return }
  if (node.type === 'file') {
    const file = { ...(node as AllmFileNode) }
    const qn = prefix ? `${prefix}/${file.name}` : file.name
    file.qualifiedName = qn
    out.push(file)
    return
  }
  const next = prefix ? (node?.name ? `${prefix}/${node.name}` : prefix) : (node?.name || "")
  if (Array.isArray(node.items)) node.items.forEach((n: any) => flatten(n, out, next))
}

export async function listFlattenedDocs(): Promise<AllmFileNode[]> {
  const data = await anythingllmRequest<AllmDocumentsResp>("/documents", "GET")
  const items = (data?.localFiles?.items ?? []) as any
  const out: AllmFileNode[] = []
  flatten(items, out)
  return out
}

export async function findDocsByFilename(filename: string, workspaceSlug?: string): Promise<string[]> {
  const all = await listFlattenedDocs()
  const lower = filename.toLowerCase()
  const pinnedFirst = all.filter((f) => {
    const pinned = Array.isArray(f?.pinnedWorkspaces) ? f.pinnedWorkspaces! : []
    const t = String(f?.title || "").trim()
    const u = String(f?.url || "").trim().toLowerCase()
    const nameMatch = t === filename || (u && u.endsWith(lower))
    return (!!workspaceSlug ? pinned.includes(workspaceSlug) : true) && nameMatch
  }).map(f => String(f.qualifiedName || f.name || "")).filter(Boolean)

  if (pinnedFirst.length) return pinnedFirst

  const loose = all.filter((f) => {
    const t = String(f?.title || "").trim()
    const u = String(f?.url || "").trim().toLowerCase()
    return t === filename || (u && u.endsWith(lower))
  }).map(f => String(f.qualifiedName || f.name || "")).filter(Boolean)

  return loose
}

export async function documentExists(docName: string): Promise<boolean> {
  try {
    await anythingllmRequest<any>(`/document/${encodeURIComponent(docName)}`, "GET")
    return true
  } catch {
    // Try with basename if qualified
    try {
      if (docName.includes('/')) {
        const short = docName.split('/').pop() as string
        await anythingllmRequest<any>(`/document/${encodeURIComponent(short)}`, "GET")
        return true
      }
    } catch {}
    return false
  }
}

export async function qualifiedNamesForShort(shortName: string): Promise<string[]> {
  const all = await listFlattenedDocs()
  return all.filter(f => (String(f.name) === shortName)).map(f => String(f.qualifiedName || f.name)).filter(Boolean)
}
