import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Native Deno process status and owned output readers, scoped to the test's data directory. */
export function createHosts({ root, directory, filename }) {
  const owned = new Set()
  const keys = ['APP_NAME', 'HOST', 'PORT', 'LOG_LEVEL', 'DATABASE_PATH', 'CACHE_TTL_MS']
  async function start() {
    const policy = join(root, '.longhorn-permissions-' + crypto.randomUUID() + '.json')
    await Deno.writeTextFile(policy, JSON.stringify({ nodeModulesDir: 'manual', lock: false, permissions: { longhorn: { read: [directory], write: [directory], env: keys, net: ['127.0.0.1'] } } }), { createNew: true, mode: 0o600 })
    let child
    try { child = new Deno.Command(Deno.execPath(), {
      args: ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--config=' + policy, '--permission-set=longhorn', join(root, 'dist/index.js')],
      cwd: root, clearEnv: true,
      env: { ...Object.fromEntries(keys.flatMap(key => { const value = Deno.env.get(key); return value === undefined ? [] : [[key, value]] })), HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', DATABASE_PATH: filename },
      stdin: 'null', stdout: 'piped', stderr: 'piped',
    }).spawn() } catch (error) { await Deno.remove(policy); throw error }
    const instance = { child, url: undefined, output: '', exited: false, status: child.status, readers: undefined, policy }
    owned.add(instance); void instance.status.then(() => { instance.exited = true })
    async function read(stream) {
      let pending = ''
      for await (const text of stream.pipeThrough(new TextDecoderStream())) {
        instance.output += text; pending += text
        let end
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1)
          try { const record = JSON.parse(line); if (record.message === 'HTTP server listening') instance.url = record.fields.url } catch {}
        }
      }
    }
    instance.readers = Promise.all([read(child.stdout), read(child.stderr)])
    const deadline = Date.now() + 8000
    while (!instance.url) {
      assert.ok(!instance.exited, instance.output)
      assert.ok(Date.now() < deadline, 'Deno startup timed out: ' + instance.output)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return instance
  }
  async function stop(instance) {
    assert.equal(instance.exited, false, instance.output)
    instance.child.kill('SIGTERM')
    let forced = false
    const timer = setTimeout(() => { if (!instance.exited) { forced = true; instance.child.kill('SIGKILL') } }, 5000)
    try {
      const result = await instance.status; await instance.readers; await Deno.remove(instance.policy)
      assert.equal(forced, false, instance.output); assert.equal(result.code, 0, instance.output); assert.equal(result.signal, null, instance.output)
      assert.ok(instance.output.includes('Application stopped'), instance.output); owned.delete(instance)
    } finally { clearTimeout(timer) }
  }
  async function close() {
    await Promise.all([...owned].map(async instance => {
      const timer = setTimeout(() => { if (!instance.exited) instance.child.kill('SIGKILL') }, 5000)
      try {
        if (!instance.exited) try { instance.child.kill('SIGTERM') } catch {}
        await instance.status; await instance.readers
        try { await Deno.remove(instance.policy) } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error }
      } finally { clearTimeout(timer); owned.delete(instance) }
    }))
  }
  return { start, stop, close }
}
