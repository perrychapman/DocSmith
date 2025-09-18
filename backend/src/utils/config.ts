import { config } from "dotenv"
config()

// Use port 3000 in production, fallback to 4000 in development
const defaultPort = process.env.NODE_ENV === 'production' ? 3000 : 4000;
export const APP_CONFIG = {
  port: process.env.PORT || defaultPort,
  anythingLLMUrl: process.env.ANYTHINGLLM_API_URL || "",
  anythingLLMKey: process.env.ANYTHINGLLM_API_KEY || "",
  // Optional: path prefix that AnythingLLM can access for local file embeddings
  // Example: LIBRARY_ROOT=C:/Projects/DocSmith/data maps to ANYTHINGLLM_INGEST_ROOT=/data in the AnythingLLM container
  anythingLLMIngestRoot: process.env.ANYTHINGLLM_INGEST_ROOT || ""
}
