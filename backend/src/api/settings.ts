import { Router } from "express"
import { readSettings, writeSettings, type AppSettings } from "../services/settings"

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

export default router

