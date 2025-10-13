// backend/src/services/fs.ts
import path from "path"
import fs from "fs"
import { randomUUID } from "crypto"

// ---------- Library Root ----------
// Absolute path to the library root (default: ./data at project root)
export function libraryRoot(): string {
  const envRoot = process.env.LIBRARY_ROOT
  
  if (envRoot) {
    // Environment variable takes precedence
    return path.resolve(envRoot)
  }
  
  // Detect if we're in a packaged Electron app
  // Check multiple indicators to ensure we catch production builds
  const isPackaged = process.env.PORTABLE_EXECUTABLE_DIR || 
                     __dirname.includes('app.asar') ||
                     __dirname.includes('Program Files')
  
  if (isPackaged) {
    // Use user's AppData in production
    const userDataPath = process.env.APPDATA || 
                         path.join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Roaming')
    const dataPath = path.join(userDataPath, 'DocSmith', 'data')
    console.log('[FS] Production mode detected, using AppData:', dataPath)
    return dataPath
  }
  
  // Development mode: use ./data relative to project root
  // __dirname is .../backend/src/services → go up two to project root
  const devPath = path.resolve(__dirname, "../../..", "./data")
  console.log('[FS] Development mode, using project data:', devPath)
  return devPath
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

// Safe filename for files (keeps alnum, space, dash, underscore, dot)
// Replaces Windows-forbidden characters and trims trailing dots/spaces
export function safeFileName(input: string): string {
  let s = String(input || '').trim()
  // Replace forbidden characters \\ / : * ? " < > |
  s = s.replace(/[\\/:*?"<>|]+/g, '_')
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ')
  // Prevent names like '.' or '..'
  if (/^\.+$/.test(s)) s = s.replace(/\./g, '_')
  // Trim trailing dots/spaces (Windows)
  s = s.replace(/[ .]+$/g, '')
  // Fallback if empty
  if (!s) s = 'untitled'
  // Limit length
  if (s.length > 120) s = s.slice(0, 120)
  return s
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

// Human-friendly name from a slug or folder (e.g., "sailpoint-discovery-sessions" -> "Sailpoint Discovery Sessions")
export function displayNameFromSlug(input: string): string {
  const s = String(input || '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return 'Untitled'
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
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
  const uploadsDir = path.join(customerDir, "uploads")
  return { root, customerDir, inputsDir, promptsDir, documentsDir, uploadsDir }
}

// Ensure customer tree exists (id + display name + createdAt for folder stamp)
export function ensureCustomerTree(id: number, name?: string, createdAt?: Date) {
  const { customerDir, inputsDir, promptsDir, documentsDir, uploadsDir } = customerPaths(id, name, createdAt)
  fs.mkdirSync(inputsDir, { recursive: true })
  fs.mkdirSync(promptsDir, { recursive: true })
  fs.mkdirSync(documentsDir, { recursive: true })
  fs.mkdirSync(uploadsDir, { recursive: true })
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
