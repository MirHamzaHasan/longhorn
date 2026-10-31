import type { SessionEntry, SessionPage, SessionRevocation } from '@longhornjs/auth/session-inventory'
export function readSessionPage(value: unknown, previous: readonly SessionEntry[] = []): SessionPage {
  const data = value as SessionPage
  if (!data || !Array.isArray(data.sessions) || data.sessions.length > 10 || (data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(data.nextCursor)))) throw new Error('Invalid session page')
  const seen = new Set(previous.map(row => row.id)); let last = previous.at(-1), current = previous.filter(row => row.current).length
  const sessions = data.sessions.map(row => {
    if (!row || typeof row.id !== 'string' || !/^[a-f0-9]{32}$/.test(row.id) || !Number.isSafeInteger(row.expiresAt) || row.expiresAt < 0 || typeof row.current !== 'boolean' || seen.has(row.id) || (last && !(row.expiresAt > last.expiresAt || row.expiresAt === last.expiresAt && row.id > last.id))) throw new Error('Invalid session entry')
    const item = Object.freeze({ id: row.id, expiresAt: row.expiresAt, current: row.current }); seen.add(item.id); last = item; if (item.current) current++; return item
  })
  if (current > 1 || (data.nextCursor && sessions.length !== 10)) throw new Error('Invalid session continuation')
  return { sessions, nextCursor: data.nextCursor }
}
export function createSessionInventoryPanel(options: {
  request: <T>(path: string, body?: unknown, managedChange?: boolean) => Promise<T>; active: () => boolean; busy: () => boolean;
  begin: () => boolean; end: () => void; signedOut: () => void; failure: (reason: unknown) => void;
  announce: (message: string) => void; own: (dispose: () => void) => void;
}): HTMLElement {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value }
  const control = (label: string, action: () => void) => { const value = node('button', label); value.type = 'button'; value.dataset.accountControl = 'true'; value.addEventListener('click', action); return value }
  const panel = node('section', undefined, 'panel account-panel session-inventory'), heading = node('div', undefined, 'session-heading'), rows = node('ul', undefined, 'session-list')
  const status = node('p', options.busy() ? 'An account change is still being checked.' : 'Reading active sessions…', 'hint'), error = node('p', undefined, 'form-error')
  let disposed = false, loading = false, changing = false, cursor: string | null = null, entries: readonly SessionEntry[] = []
  const active = () => !disposed && options.active()
  const refresh = control('Refresh sessions', () => { void load(false) }), more = control('Load more sessions', () => { void load(true) })
  rows.setAttribute('aria-label', 'Active sessions'); status.setAttribute('role', 'status'); error.setAttribute('role', 'alert'); error.hidden = true; more.hidden = true
  heading.append(node('h2', 'Active sessions'), refresh); panel.append(heading, node('p', 'These sign-ins can access your account.', 'subtle'), rows, status, error, more)
  const sync = () => { for (const button of panel.querySelectorAll<HTMLButtonElement>('button')) button.disabled = loading || changing || options.busy(); panel.setAttribute('aria-busy', String(loading || changing)) }
  const expiry = (instant: number) => { const date = new Date(instant); return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(instant) + ' ms since epoch' }
  function row(entry: SessionEntry, position: number) {
    const item = node('li', undefined, 'session-row'), details = node('div'), label = entry.current ? 'This session' : 'Session ' + position
    details.append(node('strong', label), node('p', 'Expires ' + expiry(entry.expiresAt), 'hint'))
    const end = control('End session', () => {
      if (!active() || loading || changing || options.busy()) return
      end.hidden = true; const confirm = node('div', undefined, 'session-confirm'), actions = node('div', undefined, 'actions')
      confirm.setAttribute('role', 'group'); confirm.setAttribute('aria-label', 'Confirm sign-out for ' + label.toLowerCase())
      const cancel = control('Cancel', () => { confirm.remove(); end.hidden = false; if (active()) end.focus() })
      const submit = control('End session', () => {
        if (!active() || changing || !options.begin()) return
        changing = true; error.hidden = true; rows.replaceChildren(); cursor = null; more.hidden = true; status.textContent = 'Ending the session…'; sync()
        void (async () => {
          let focusAfterChange = false, finish: (() => void) | undefined
          try {
            const result = await options.request<SessionRevocation>('/sessions/end', { id: entry.id }, true)
            if (!result || ![0, 1].includes(result.revokedSessions) || typeof result.current !== 'boolean' || (result.current && result.revokedSessions !== 1)) throw new Error('Invalid session change')
            if (result.current) { finish = options.signedOut; return }
            if (active()) { await load(false, true); if (active()) { focusAfterChange = true; options.announce(result.revokedSessions ? 'Session ended.' : 'That session has already ended.') } }
          } catch (reason) { finish = () => options.failure(reason) }
          finally { changing = false; options.end(); if (finish) finish(); else if (active()) { sync(); if (focusAfterChange) refresh.focus() } }
        })()
      })
      confirm.append(node('p', entry.current ? 'This browser will be signed out.' : 'This sign-in will end.', 'hint')); actions.append(submit, cancel); confirm.append(actions); item.append(confirm); cancel.focus()
    })
    end.setAttribute('aria-label', entry.current ? 'End session in this browser' : 'End ' + label.toLowerCase()); item.append(details, end); return item
  }
  async function load(append: boolean, duringChange = false) {
    if (!active() || loading || (options.busy() && !duringChange) || (append && !cursor)) return
    const focused = document.activeElement === more ? more : document.activeElement === refresh ? refresh : undefined
    loading = true; error.hidden = true; if (!append) { rows.replaceChildren(); entries = []; cursor = null; more.hidden = true }
    status.textContent = 'Reading active sessions…'; sync()
    try {
      const data = readSessionPage(await options.request<unknown>('/sessions?limit=10' + (append ? '&cursor=' + encodeURIComponent(cursor!) : ''), undefined, duringChange), append ? entries : [])
      if (!active()) return
      const offset = entries.length; entries = [...entries, ...data.sessions]; rows.append(...data.sessions.map((entry, index) => row(entry, offset + index + 1))); cursor = data.nextCursor; more.hidden = !cursor
      status.textContent = entries.length === 0 ? 'No active sessions were returned. Refresh to check again.' : entries.length + (entries.length === 1 ? ' active session shown.' : ' active sessions shown.')
    } catch (reason) {
      if (duringChange) throw reason
      if (!active()) return
      rows.replaceChildren(); entries = []; cursor = null
      error.textContent = 'Could not load sessions. Refresh to try again.'; error.hidden = false; status.textContent = ''; more.hidden = true
    } finally { loading = false; if (active()) { sync(); if (focused) (focused.hidden ? refresh : focused).focus() } }
  }
  const changed = () => { if (active() && !options.busy()) void load(false) }
  window.addEventListener('longhorn:sessions-changed', changed)
  options.own(() => { disposed = true; entries = []; cursor = null; rows.replaceChildren(); window.removeEventListener('longhorn:sessions-changed', changed) })
  sync()
  queueMicrotask(() => { if (active()) void load(false) }); return panel
}
