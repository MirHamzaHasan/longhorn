import { createCommandFollow } from './command-follow.js'
import { collectHistoryWindow, readHistoryPage } from './history-live.js'
import type { HistoryPage } from './history-live.js'
import type { CommandHistoryItem } from '../src/command-history.js'

/** One history page owns reads, cursor, DOM identities and pause controls. */
export function createHistoryList(options: {
  initial: unknown; active: () => boolean; own: (dispose: () => void) => void;
  read: (input: Readonly<{ limit: number; after: string | null; signal: AbortSignal }>) => Promise<unknown>;
  row: (command: CommandHistoryItem) => HTMLLIElement; update: (row: HTMLLIElement, command: CommandHistoryItem) => void;
  empty: () => HTMLElement; announce: (message: string) => void; denied: (error: unknown) => HTMLElement | undefined; refresh: () => void;
}) {
  const { active, own, read, row, update, empty, denied, refresh, announce } = options
  const initial = readHistoryPage(options.initial, 20)
  let entries = initial.commands, cursor = initial.nextCursor
  let disposed = false, paging = false, slots = 1, deniedView = false, currentRead: Promise<void> | undefined, paginationAbort: AbortController | undefined
  const present = () => !disposed && active(), known = new Map<string, HTMLLIElement>()
  const element = document.createElement('div'), controls = document.createElement('section'), message = document.createElement('p'), control = document.createElement('button'), rows = document.createElement('ul'), emptyBody = document.createElement('div'), more = document.createElement('button')
  controls.className = 'history-updates'; controls.setAttribute('aria-label', 'Command list updates'); message.className = 'subtle'; message.setAttribute('role', 'status'); message.setAttribute('aria-atomic', 'true')
  rows.className = 'rows'; rows.setAttribute('aria-label', 'Command history'); more.className = 'more'; more.textContent = 'Load older commands'; more.type = control.type = 'button'
  controls.append(message, control); element.append(controls, rows, emptyBody, more)
  const blocked = () => document.hidden || !navigator.onLine || paging
  function reconcile(page: HistoryPage, initial = false) {
    if (!present()) return
    const focused = document.activeElement instanceof HTMLElement && (rows.contains(document.activeElement) || emptyBody.contains(document.activeElement) || document.activeElement === more) ? document.activeElement : undefined
    const focusedRow = !!focused && rows.contains(focused)
    const anchor = Array.from(rows.children).find(child => child.getBoundingClientRect().bottom > 0) as HTMLElement | undefined
    const top = anchor?.getBoundingClientRect().top, old = new Map(entries.map(command => [command.id, JSON.stringify(command)])), ids = new Set(page.commands.map(command => command.id))
    let next = rows.firstChild, added = 0, changed = 0
    for (const command of page.commands) {
      let item = known.get(command.id)
      if (!item) { item = row(command); item.dataset.commandId = command.id; known.set(command.id, item); added++ }
      else if (old.get(command.id) !== JSON.stringify(command)) { update(item, command); changed++ }
      if (item !== next) rows.insertBefore(item, next)
      next = item.nextSibling
    }
    let removed = 0
    for (const [id, item] of known) if (!ids.has(id)) { item.remove(); known.delete(id); removed++ }
    entries = page.commands; cursor = page.nextCursor; rows.hidden = !entries.length; emptyBody.hidden = !!entries.length
    if (entries.length) emptyBody.replaceChildren(); else if (!emptyBody.childNodes.length) emptyBody.append(empty())
    more.hidden = !cursor
    const lostFocus = !!focused && (!focused.isConnected || focused === more && more.hidden)
    if (focused && !lostFocus && document.activeElement !== focused) focused.focus({ preventScroll: true })
    if (lostFocus) control.focus({ preventScroll: true })
    if (anchor?.isConnected && top !== undefined) window.scrollBy(0, anchor.getBoundingClientRect().top - top)
    if (!initial && (added || removed || changed)) { message.textContent = 'List updated. ' + entries.length + (entries.length === 1 ? ' command shown.' : ' commands shown.') + (lostFocus ? focusedRow ? ' The selected command left this view.' : ' Focus moved to list updates.' : '') }
  }
  function refuse(error: unknown) {
    const content = denied(error); if (!content) return false
    const focused = document.activeElement instanceof HTMLElement && element.contains(document.activeElement) ? document.activeElement : undefined
    entries = []; cursor = null; known.clear(); rows.replaceChildren(); rows.hidden = true; more.hidden = true; emptyBody.hidden = false; emptyBody.replaceChildren(content); deniedView = true; control.hidden = message.hidden = true; follow.stop()
    content.setAttribute('role', 'alert'); if (focused && (!focused.isConnected || focused === control || focused === more)) content.querySelector<HTMLElement>('a,button')?.focus({ preventScroll: true })
    return true
  }
  const follow = createCommandFollow({ intervalMs: 5000, budgetMs: 120000, maxChecks: 24,
    read(signal) {
      const task = (async () => { const page = await collectHistoryWindow({ slots, signal, read }); if (!signal.aborted && present()) reconcile(page) })()
      currentRead = task
      return task.then(() => false).finally(() => { if (currentRead === task) currentRead = undefined })
    },
    change(state, error) {
      if (!present() || deniedView) return
      control.textContent = state === 'following' || state === 'paused' ? 'Pause list updates' : state === 'error' ? 'Try list updates' : state === 'limit' ? 'Check list again' : slots > 10 ? 'Refresh list' : 'Resume list updates'
      if (state === 'error' && refuse(error)) return
      message.textContent = state === 'following' ? 'Keeping this list up to date for two minutes.' : state === 'paused' ? paging ? 'Checking older commands. List updates are paused.' : 'List updates are paused while this tab is hidden or offline.' : state === 'limit' ? 'List updates stopped after two minutes or 24 checks. Check again when you’re ready.' : state === 'error' ? 'List updates stopped. ' + (error instanceof Error ? error.message : 'Refresh to try again.') : slots > 10 ? 'Updates paused while you browse older commands. Refresh the list to check again.' : 'List updates paused. Resume when you’re ready.'
    },
  })
  control.addEventListener('click', () => { if (!present() || deniedView) return; if (slots > 10) refresh(); else if (follow.active) follow.stop(); else follow.start() })
  more.addEventListener('click', () => {
    if (!present() || paging || !cursor || deniedView) return
    paging = true; const controller = new AbortController(); paginationAbort = controller; follow.setPaused(true); more.setAttribute('aria-disabled', 'true')
    void (async () => {
      try {
        await currentRead?.catch(() => {})
        if (!present() || !cursor || deniedView) return
        const next = readHistoryPage(await read({ limit: 20, after: cursor, signal: controller.signal }), 20, entries)
        if (!present()) return
        slots++; reconcile({ commands: [...entries, ...next.commands], nextCursor: next.nextCursor }, true)
        if (slots > 10) { follow.stop(); control.textContent = 'Refresh list' }
        message.textContent = slots > 10 ? 'Updates paused while you browse older commands. Refresh the list to check again.' : 'Loaded ' + next.commands.length + ' older commands.'
        announce('Loaded ' + next.commands.length + ' older commands.'); if (more.hidden) control.focus({ preventScroll: true })
      } catch (error) { if (present() && !refuse(error)) { follow.stop(); message.textContent = error instanceof Error ? error.message : 'Could not load older commands. Try again.' } }
      finally { if (paginationAbort === controller) paginationAbort = undefined; paging = false; more.setAttribute('aria-disabled', 'false'); if (present()) follow.setPaused(blocked()) }
    })()
  })
  const visibility = () => follow.setPaused(blocked())
  document.addEventListener('visibilitychange', visibility); window.addEventListener('online', visibility); window.addEventListener('offline', visibility)
  own(() => { disposed = true; follow.dispose(); paginationAbort?.abort(); entries = []; cursor = null; known.clear(); rows.replaceChildren(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', visibility); window.removeEventListener('offline', visibility) })
  reconcile({ commands: entries, nextCursor: cursor }, true); visibility(); follow.start()
  return element
}
