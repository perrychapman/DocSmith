import { Router } from "express"
import { getDB } from "../services/storage"

const router = Router()

// Create a prompt
router.post("/", (req, res) => {
  const { customerId, userInput, customerInput } = req.body as {
    customerId?: number | string
    userInput?: string
    customerInput?: string
  }

  if (!customerId || !customerInput) {
    return res.status(400).json({ error: "customerId and customerInput are required" })
  }

  const db = getDB()
  const createdAt = new Date().toISOString()

  db.run(
    `INSERT INTO prompts (customerId, userInput, customerInput, createdAt) 
     VALUES (?, ?, ?, ?)`,
    [customerId, userInput || "", customerInput, createdAt],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message })
      }
      res.status(201).json({
        id: this.lastID,
        customerId,
        userInput: userInput || "",
        customerInput,
        createdAt
      })
    }
  )
})

// Get all prompts for a customer
router.get("/:customerId", (req, res) => {
  const { customerId } = req.params
  const db = getDB()

  db.all(
    "SELECT * FROM prompts WHERE customerId = ? ORDER BY createdAt DESC",
    [customerId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message })
      }
      res.json(rows)
    }
  )
})

export default router
