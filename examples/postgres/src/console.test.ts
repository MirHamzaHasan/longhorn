import { expect, it } from 'vitest'
import { Longhorn } from '@longhorn/core'
import { configureConsole } from './console.js'
import { createPostgresApp } from './app.js'

it('serves a public shell with restrictive browser policy and no reflected request data', async () => {
  const app = new Longhorn()
  configureConsole(app, { script: 'export {}', style: ':root{color-scheme:light dark}' })
  try {
    const response = await app.fetch(new Request('http://localhost/console?token=private-secret&name=%3Cscript%3E'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    const policy = response.headers.get('Content-Security-Policy')!
    expect(policy).toContain("connect-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/)
    const html = await response.text()
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('src="/console/app.js"')
    expect(html).not.toMatch(/private-secret|<script>session|DATABASE_URL/)
  } finally { await app.close() }
})

it('serves only the supplied assets at fixed paths with correct types', async () => {
  const app = new Longhorn()
  configureConsole(app, { script: 'export const sample=1', style: 'body{color:black}' })
  try {
    for (const [path, type, body] of [['app.js', 'text/javascript', 'export const sample=1'], ['app.css', 'text/css', 'body{color:black}']]) {
      const response = await app.fetch(new Request('http://localhost/console/' + path))
      expect(response.headers.get('Content-Type')).toContain(type)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.text()).toBe(body)
    }
    expect((await app.fetch(new Request('http://localhost/console/.operator.env'))).status).toBe(404)
  } finally { await app.close() }
})

it('rejects a console host without account operations before opening a database', () => {
  let opened = false
  expect(() => createPostgresApp({ openDatabase: async () => { opened = true; throw new Error('unreachable') }, console: { script: '', style: '' } })).toThrow('console requires account operations')
  expect(opened).toBe(false)
})


it('exposes only the host password capability and keeps account navigation in the authenticated shell', async () => {
  for (const enabled of [false, true]) for (const sessions of [false, true]) {
    const app = new Longhorn()
    configureConsole(app, { script: '', style: '' }, { passwordChanges: enabled, sessionControls: sessions })
    try {
      const response = await app.fetch(new Request('http://localhost/console?passwordChanges=true&sessionControls=true'))
      const html = await response.text()
      expect(html).toContain('data-password-changes="' + enabled + '"')
      expect(html).toContain('data-session-controls="' + sessions + '"')
      expect(html).toContain('href="#/account" data-nav="account">Account</a>')
      expect(html).toContain('<aside id="sidebar" hidden>')
    } finally { await app.close() }
  }
})
