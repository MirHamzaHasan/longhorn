import { readFile } from 'node:fs/promises'
import type { ConsoleAssets } from './console.js'
/** Node host acquisition; the shared app receives immutable asset text, never a filesystem path. */
export async function loadConsoleAssets():Promise<ConsoleAssets>{
  const [script,style]=await Promise.all([readFile(new URL('./console/app.js',import.meta.url),'utf8'),readFile(new URL('./console/app.css',import.meta.url),'utf8')])
  return Object.freeze({script,style})
}
