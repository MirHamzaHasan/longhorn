import { expect, it } from 'vitest'
import { Longhorn } from '@longhorn/core'
import { nodeRuntime } from '@longhorn/node'

it('drains an active HTTP request before releasing application resources', async () => {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  let resourceOpen = false
  const app = new Longhorn().onStart(() => {
    resourceOpen = true
    return () => { resourceOpen = false }
  })
  app.http.get('/', async (c) => {
    enter()
    await gate
    return c.json({ resourceOpen })
  })
  const server = await app.listen(nodeRuntime, { port: 0 })
  try {
    const request = fetch(server.url, { headers: { Connection: 'close' } })
    await entered
    const closing = app.close()
    expect(resourceOpen).toBe(true)
    release()
    expect(await (await request).json()).toEqual({ resourceOpen: true })
    await closing
    expect(resourceOpen).toBe(false)
  } finally {
    release()
    await app.close()
  }
})
