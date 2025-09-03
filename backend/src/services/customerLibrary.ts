// backend/src/services/customerLibrary.ts
// High-level helpers for per-customer library folders and document paths.

import fs from "fs"
import path from "path"
import {
  customerFolderName,
  customerPaths,
  ensureCustomerTree,
  safeSlug,
} from "./fs"

function toDate(d: Date | string | undefined): Date | undefined {
  if (!d) return undefined
  if (d instanceof Date) return d
  const t = new Date(d)
  return Number.isFinite(t.getTime()) ? t : undefined
}

// Compute the canonical folder name for a customer
export function folderNameForCustomer(id: number, name?: string, createdAt?: Date | string) {
  return customerFolderName(id, name, toDate(createdAt))
}

// Resolve standard paths for a customer (does not create)
export function resolveCustomerPaths(id: number, name?: string, createdAt?: Date | string) {
  const d = toDate(createdAt)
  return customerPaths(id, name, d)
}

// Ensure the inputs/prompts/documents tree exists
export function ensureCustomerLibrary(id: number, name?: string, createdAt?: Date | string) {
  const d = toDate(createdAt)
  return ensureCustomerTree(id, name, d)
}

// Path to the documents directory
export function documentsDirForCustomer(id: number, name?: string, createdAt?: Date | string) {
  return resolveCustomerPaths(id, name, createdAt).documentsDir
}

// Ensure documents directory exists
export function ensureDocumentsDir(id: number, name?: string, createdAt?: Date | string) {
  const { documentsDir } = resolveCustomerPaths(id, name, createdAt)
  fs.mkdirSync(documentsDir, { recursive: true })
  return documentsDir
}

// Path to the uploads directory
export function uploadsDirForCustomer(id: number, name?: string, createdAt?: Date | string) {
  return resolveCustomerPaths(id, name, createdAt).uploadsDir
}

// Ensure uploads directory exists
export function ensureUploadsDir(id: number, name?: string, createdAt?: Date | string) {
  const { uploadsDir } = resolveCustomerPaths(id, name, createdAt)
  fs.mkdirSync(uploadsDir, { recursive: true })
  return uploadsDir
}

// Compute a new file path inside the customer's documents dir
export function newDocumentPath(
  id: number,
  name: string,
  createdAt: Date | string,
  type: string,
  opts?: { ext?: string; title?: string }
) {
  const dir = ensureDocumentsDir(id, name, createdAt)
  const ext = (opts?.ext || ".docx").replace(/^[^.]/, ".$&")
  const base = opts?.title ? safeSlug(opts.title) : safeSlug(type)
  const filename = `${base}-${Date.now()}${ext}`
  return path.join(dir, filename)
}

// List files in the customer's documents directory (flat list)
export function listDocumentFiles(id: number, name: string, createdAt: Date | string) {
  const dir = documentsDirForCustomer(id, name, createdAt)
  try {
    if (!fs.existsSync(dir)) return [] as string[]
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(dir, e.name))
  } catch {
    return [] as string[]
  }
}

// List files in the customer's uploads directory (flat list)
export function listUploadFiles(id: number, name: string, createdAt: Date | string) {
  const dir = uploadsDirForCustomer(id, name, createdAt)
  try {
    if (!fs.existsSync(dir)) return [] as string[]
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(dir, e.name))
  } catch {
    return [] as string[]
  }
}

