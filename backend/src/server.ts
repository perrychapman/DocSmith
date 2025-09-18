import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import fs from "fs";
import { APP_CONFIG } from "./utils/config";
import { logInfo } from "./utils/logger";

import customersRouter from "./api/customers";
import promptsRouter from "./api/prompts";
import documentsRouter from "./api/documents";
import uploadsRouter from "./api/uploads";
import testRouter from "./api/test";
import templatesRouter from "./api/templates";
import generateRouter from "./api/generate";
import settingsRouter from "./api/settings";
import resetRouter from "./api/reset";

// CommonJS-safe import for AnythingLLM router
// eslint-disable-next-line @typescript-eslint/no-var-requires
const anythingllmRouterModule = require("./api/anythingllm");
const anythingllmRouter = anythingllmRouterModule.default ?? anythingllmRouterModule;

const app = express();

app.use(cors());
app.use(bodyParser.json());

// --- Minimal request logger ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${ms}ms`);
  });
  next();
});

// Identify this runtime across all API responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.setHeader('X-DocSmith-Signature', 'naming-v2');
  }
  next();
});

// --- Health check routes ---
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, signature: 'naming-v2' });
});
// Explicit API health for proxy checks
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, signature: 'naming-v2' });
});

// --- Static UI ---
// Serve the lightweight frontend from /frontend
const FRONTEND_DIR = path.resolve(__dirname, "../../frontend");
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));

  // Serve index.html for the app root
  app.get("/", (_req, res) => {
    const indexPath = path.join(FRONTEND_DIR, "index.html");
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    return res.status(200).send(
      "<html><body><h1>DocSmith</h1><p>Frontend not found.</p></body></html>"
    );
  });
}

// --- Application routes ---
app.use("/api/customers", customersRouter);
app.use("/api/prompts", promptsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/generate", generateRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/test", testRouter);
app.use("/api/anythingllm", anythingllmRouter);
app.use("/api/reset", resetRouter);

// --- Catch-all 404 ---
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

const server = app.listen(APP_CONFIG.port, () => {
  logInfo(`Backend running at http://localhost:${APP_CONFIG.port}`);
});

// Graceful shutdown handling
function gracefulShutdown(signal: string) {
  logInfo(`Received ${signal}, starting graceful shutdown...`);
  
  server.close(() => {
    logInfo('HTTP server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logInfo('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  logInfo(`Uncaught Exception: ${err.message}`);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logInfo(`Unhandled Rejection: ${reason}`);
  gracefulShutdown('unhandledRejection');
});
