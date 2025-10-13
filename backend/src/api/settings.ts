import { Router } from "express"
import { readSettings, writeSettings, type AppSettings } from "../services/settings"
import { discoverAnythingLLMPort } from "../services/anythingllmDiscovery"

const router = Router()

router.get("/", (_req, res) => {
  try { res.json(readSettings()) } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

router.post("/", (req, res) => {
  try {
    const body = (req.body || {}) as AppSettings
    const current = readSettings()
    const next = { ...current, ...body }
    writeSettings(next)
    res.json(next)
  } catch (e) { res.status(500).json({ error: (e as Error).message }) }
})

// Auto-discover AnythingLLM Desktop port
router.post("/discover-anythingllm", async (_req, res) => {
  try {
    const port = await discoverAnythingLLMPort()
    
    if (port) {
      const current = readSettings()
      const newUrl = `http://localhost:${port}`
      writeSettings({ ...current, anythingLLMUrl: newUrl })
      
      res.json({ 
        success: true, 
        port, 
        url: newUrl,
        message: `Found AnythingLLM Desktop on port ${port}` 
      })
    } else {
      res.json({ 
        success: false, 
        message: 'Could not find AnythingLLM Desktop. Make sure it is running.' 
      })
    }
  } catch (e) { 
    res.status(500).json({ success: false, error: (e as Error).message }) 
  }
})

export default router

