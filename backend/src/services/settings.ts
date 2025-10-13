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
    console.log('[SETTINGS] Config directory:', dir)
  } catch (e) {
    console.error('[SETTINGS] Failed to create config directory:', e)
  }
  return path.join(dir, "settings.json")
}

export function readSettings(): AppSettings {
  try {
    const p = settingsPath()
    console.log('[SETTINGS] Reading from:', p)
    if (!fs.existsSync(p)) {
      console.log('[SETTINGS] File does not exist, returning empty settings')
      return {}
    }
    const raw = fs.readFileSync(p, "utf-8")
    const obj = JSON.parse(raw)
    console.log('[SETTINGS] Loaded:', { hasUrl: !!obj.anythingLLMUrl, hasKey: !!obj.anythingLLMKey })
    return obj || {}
  } catch (e) { 
    console.error('[SETTINGS] Read error:', e)
    return {}
  }
}

export function writeSettings(next: AppSettings) {
  try {
    const p = settingsPath()
    console.log('[SETTINGS] Writing to:', p, { hasUrl: !!next.anythingLLMUrl, hasKey: !!next.anythingLLMKey })
    fs.writeFileSync(p, JSON.stringify(next || {}, null, 2), "utf-8")
    console.log('[SETTINGS] Write successful')
  } catch (e) {
    console.error('[SETTINGS] Write error:', e)
  }
}



