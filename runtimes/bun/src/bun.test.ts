import { expect, it } from 'vitest'
import { serve } from './index.js'

it('reports the required host when called outside Bun', async () => {
  await expect(serve({ fetch: () => new Response('ok') })).rejects.toThrow('must run in Bun')
})
