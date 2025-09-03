// backend/src/services/fs.ts
import path from "path"
import fs from "fs"
import { randomUUID } from "crypto"

// ---------- Library Root ----------
// Absolute path to the library root (default: ./data at project root)
export function libraryRoot(): string {
  const envRoot = process.env.LIBRARY_ROOT || "./data"
  // __dirname is .../backend/src/services → go up two to project root
  return path.resolve(__dirname, "../../..", envRoot)
}

// ---------- Name Helpers ----------
// Safe-ish slug for folder names (keeps case, replaces spaces with "-")
export function safeSlug(input: string): string {
  return (input || "")
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled"
}

// Folder name strategy: {CustomerName}_{Month_Year}
// Example: "Acme Corp" + Aug 2025 → "Acme-Corp_Aug_2025"
export function customerFolderName(id: number, name?: string, createdAt?: Date): string {
  const safeName = safeSlug(name || `customer-${id}`)
  const d = createdAt ?? new Date()
  const month = d.toLocaleString("en-US", { month: "short" }) // Jan, Feb, ... Aug
  const year = d.getFullYear()
  return `${safeName}_${month}_${year}`
}

// ---------- Customer Paths ----------
// Compute standard customer paths (does not create them)
export function customerPaths(id: number, name?: string, createdAt?: Date) {
  const root = libraryRoot()
  const folder = customerFolderName(id, name, createdAt)
  const customerDir = path.join(root, "customers", folder)
  const inputsDir = path.join(customerDir, "inputs")
  const promptsDir = path.join(customerDir, "prompts")
  const documentsDir = path.join(customerDir, "documents")
  return { root, customerDir, inputsDir, promptsDir, documentsDir }
}

// Ensure customer tree exists (id + display name + createdAt for folder stamp)
export function ensureCustomerTree(id: number, name?: string, createdAt?: Date) {
  const { customerDir, inputsDir, promptsDir, documentsDir } = customerPaths(id, name, createdAt)
  fs.mkdirSync(inputsDir, { recursive: true })
  fs.mkdirSync(promptsDir, { recursive: true })
  fs.mkdirSync(documentsDir, { recursive: true })
  return { customerDir, inputsDir, promptsDir, documentsDir }
}

// ---------- Documents ----------
// Directory for a given document title under a docType (e.g., discovery/design)
export function docTitleDir(
  customerId: number,
  docType: string,
  title: string,
  customerName?: string,
  customerCreatedAt?: Date
) {
  const { documentsDir } = customerPaths(customerId, customerName, customerCreatedAt)
  return path.join(documentsDir, docType, safeSlug(title))
}

// Compute next version folder name (v001, v002, …)
export function nextVersionDir(baseDir: string): string {
  let max = 0
  if (fs.existsSync(baseDir)) {
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const m = /^v(\d{3})$/.exec(entry.name)
        if (m) max = Math.max(max, parseInt(m[1], 10))
      }
    }
  }
  const next = (max + 1).toString().padStart(3, "0")
  return path.join(baseDir, `v${next}`)
}

// Temp cache path for preview documents before user saves a version
export function tempDocPath(): string {
  const cacheDir = path.join(libraryRoot(), ".cache")
  fs.mkdirSync(cacheDir, { recursive: true })
  return path.join(cacheDir, `${randomUUID()}.docx`)
}

// ---------- Utilities ----------
// Recursive delete (best-effort “rm -rf”)
export function rmrf(targetPath: string) {
  try {
    if (!targetPath) return
    if (!fs.existsSync(targetPath)) return
    fs.rmSync(targetPath, { recursive: true, force: true })
  } catch {
    // swallow; caller can decide how to react/log
  }
}
