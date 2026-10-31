// Local preview of the website. Pages serves the same files without this script.
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const port = Number(process.env.PORT ?? 4173)

createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(root, path.endsWith('/') ? join(path, 'index.html') : path)
  try {
    if (!statSync(file).isFile()) throw new Error('Not a file')
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  } catch {
    response.writeHead(404).end('Not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`))
