// backend/src/utils/logger.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOG_PATH = path.join(os.tmpdir(), 'docsmith-electron.log');

function logToFile(message: string) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_PATH, `[${timestamp}] [BACKEND] ${message}\n`);
  } catch (err) {
    // Silent fail - don't crash if logging fails
  }
}

export function logInfo(msg: string) {
  console.log(`${msg}`);
  logToFile(msg);
}

export function logError(msg: string, err?: unknown) {
  console.error(`${msg}`, err ?? "");
  logToFile(`${msg} ${err ? JSON.stringify(err) : ''}`);
}
