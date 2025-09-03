import { config } from "dotenv"
config()

export const APP_CONFIG = {
  port: process.env.PORT || 4000,
  anythingLLMUrl: process.env.ANYTHINGLLM_API_URL || "",
  anythingLLMKey: process.env.ANYTHINGLLM_API_KEY || "",
  // Optional: path prefix that AnythingLLM can access for local file embeddings
  // Example: LIBRARY_ROOT=C:/Projects/DocSmith/data maps to ANYTHINGLLM_INGEST_ROOT=/data in the AnythingLLM container
  anythingLLMIngestRoot: process.env.ANYTHINGLLM_INGEST_ROOT || ""
}
