import { config } from "dotenv"
config()

export const APP_CONFIG = {
  port: process.env.PORT || 4000,
  anythingLLMUrl: process.env.ANYTHINGLLM_API_URL || "",
  anythingLLMKey: process.env.ANYTHINGLLM_API_KEY || ""
}
