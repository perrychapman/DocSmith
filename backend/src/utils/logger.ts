// backend/src/utils/logger.ts
export function logInfo(msg: string) {
  console.log(`${msg}`)
}

export function logError(msg: string, err?: unknown) {
  console.error(`${msg}`, err ?? "")
}
