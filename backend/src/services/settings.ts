import fs from "fs"
import path from "path"
import { libraryRoot } from "./fs"

export type AppSettings = {
  anythingLLMUrl?: string
  anythingLLMKey?: string
}

function settingsPath() {
  const dir = path.join(libraryRoot(), ".config")
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return path.join(dir, "settings.json")
}

export function readSettings(): AppSettings {
  try {
    const p = settingsPath()
    if (!fs.existsSync(p)) return {}
    const raw = fs.readFileSync(p, "utf-8")
    const obj = JSON.parse(raw)
    return obj || {}
  } catch { return {} }
}

export function writeSettings(next: AppSettings) {
  try {
    const p = settingsPath()
    fs.writeFileSync(p, JSON.stringify(next || {}, null, 2), "utf-8")
  } catch {}
}



