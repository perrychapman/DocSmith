import fs from "fs"
import path from "path"
import { libraryRoot } from "./fs"

export type AppSettings = {
  anythingLLMUrl?: string
  anythingLLMKey?: string
}

function settingsPath() {
  const dir = path.join(libraryRoot(), ".config")
  try { 
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    console.error('[SETTINGS] Failed to create config directory:', e)
  }
  return path.join(dir, "settings.json")
}

export function readSettings(): AppSettings {
  try {
    const p = settingsPath()
    if (!fs.existsSync(p)) {
      return {}
    }
    const raw = fs.readFileSync(p, "utf-8")
    const obj = JSON.parse(raw)
    return obj || {}
  } catch (e) { 
    console.error('[SETTINGS] Read error:', e)
    return {}
  }
}

export function writeSettings(next: AppSettings) {
  try {
    const p = settingsPath()
    const current = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {}
    const changed = JSON.stringify(current) !== JSON.stringify(next)
    
    if (changed) {
      console.log('[SETTINGS] Updated:', { hasUrl: !!next.anythingLLMUrl, hasKey: !!next.anythingLLMKey })
    }
    
    fs.writeFileSync(p, JSON.stringify(next || {}, null, 2), "utf-8")
  } catch (e) {
    console.error('[SETTINGS] Write error:', e)
  }
}



