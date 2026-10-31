const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]
const docs = (name) => `https://github.com/MirHamzaHasan/longhorn/blob/main/docs/${name}.md`

/* Pipeline: each scenario is a script of the behaviour its linked guide tests. */
const line = $('#line'), log = $('#log'), outcome = $('#outcome'), proof = $('#proof'), paper = $('#paper'), paperFoot = $('#paper-foot')
const stops = Object.fromEntries($$('.stop', line).map((stop) => [stop.dataset.stop, stop]))
const counts = { commands: $('#count-commands'), attempts: $('#count-attempts'), receipts: $('#count-receipts') }
let current = 0, paperAnimation

class Superseded extends Error {}
const pace = () => (reduced.matches ? 0 : 1)

function sleep(run, ms) {
  return new Promise((resolve, reject) => {
    setTimeout(() => (run === current ? resolve() : reject(new Superseded())), ms * pace())
  })
}
function set(name, state, note) {
  stops[name].dataset.state = state
  $('[data-note]', stops[name]).textContent = note
}
function say(text, tone) {
  const item = document.createElement('li')
  item.textContent = text
  item.className = 'fresh'
  if (tone) item.dataset.tone = tone
  log.append(item)
}
function bump(name, value) {
  const element = counts[name]
  element.textContent = String(value)
  element.classList.remove('bump')
  void element.offsetWidth
  element.classList.add('bump')
}
function centre(name) {
  const node = $('.node', stops[name]).getBoundingClientRect(), box = line.getBoundingClientRect()
  return { x: node.left - box.left, y: node.top - box.top }
}
/* Moves a token between stops. `until` below 1 makes it vanish on the way, as a lost message does. */
async function travel(run, from, to, { kind = 'command', until = 1, ms = 620 } = {}) {
  if (run !== current) throw new Superseded()
  if (reduced.matches) return
  const token = document.createElement('span'), a = centre(from), b = centre(to)
  token.className = 'token'
  token.dataset.kind = kind
  line.append(token)
  const at = (t) => `translate(${a.x + (b.x - a.x) * t}px,${a.y + (b.y - a.y) * t}px)`
  const frames = until < 1
    ? [{ transform: at(0), opacity: 1 }, { transform: at(until), opacity: 1, offset: .8 }, { transform: at(until), opacity: 0, scale: 2.4 }]
    : [{ transform: at(0) }, { transform: at(1) }]
  try {
    await token.animate(frames, { duration: ms, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' }).finished
  } finally {
    token.remove()
  }
  if (run !== current) throw new Superseded()
}
function printReceipt(foot) {
  paperFoot.textContent = foot
  paperAnimation?.cancel()
  if (reduced.matches) { paper.style.transform = 'none'; return }
  paperAnimation = paper.animate([{ transform: 'translateY(-101%)' }, { transform: 'none' }], { duration: 1500, easing: 'steps(22)', fill: 'forwards' })
}
function reset() {
  log.textContent = ''
  outcome.textContent = ''
  proof.textContent = ''
  paperAnimation?.cancel()
  paper.style.transform = ''
  for (const name of Object.keys(stops)) set(name, 'idle', 'Waiting')
  delete stops.dispatch.dataset.link
  for (const element of Object.values(counts)) element.textContent = '0'
  for (const token of $$('.token', line)) token.remove()
}
function finish(text, guide, label, footer) {
  outcome.textContent = text
  proof.innerHTML = ''
  proof.append('Tested in ')
  const link = document.createElement('a')
  link.href = docs(guide)
  link.textContent = label
  proof.append(link, '.')
  if (footer) paperFoot.textContent = footer
}

async function request(run, note = 'Request sent') {
  set('client', 'busy', note)
  say('The client sends 4, 8, 15 with the request key create-1.')
  await travel(run, 'client', 'tx')
  set('tx', 'busy', 'Writing')
}
async function commit(run) {
  await sleep(run, 500)
  say('One transaction saves the command, its outgoing message and the reply.')
  bump('commands', 1)
  set('tx', 'ok', 'Committed')
}
async function reply(run) {
  await travel(run, 'tx', 'client', { kind: 'reply' })
  set('client', 'ok', 'Got the command ID')
  say('The client gets its command ID. Delivery continues without it.')
}
async function deliver(run, attempt, until = 1) {
  bump('attempts', attempt)
  set('dispatch', 'busy', `Attempt ${attempt} of 3`)
  if (attempt === 1) await travel(run, 'tx', 'dispatch', { ms: 520 })
  await travel(run, 'dispatch', 'receiver', { until })
}

const scenarios = {
  async normal(run) {
    await request(run); await commit(run); await reply(run)
    await sleep(run, 300)
    say('The dispatcher claims the message and sends it to the receiver.')
    await deliver(run, 1)
    set('receiver', 'ok', 'Stored the result')
    bump('receipts', 1)
    say('The receiver computes the result and stores it under the message ID.')
    await travel(run, 'receiver', 'dispatch', { kind: 'reply' })
    set('dispatch', 'ok', 'Delivered')
    printReceipt('Delivered on attempt 1.')
    finish('One command, one delivery, one receipt.', 'console-testing', 'the console gate')
  },
  async down(run) {
    set('receiver', 'bad', 'Down')
    stops.dispatch.dataset.link = 'cut'
    await request(run); await commit(run); await reply(run)
    await sleep(run, 300)
    say('The receiver is down. The command is already safe, so the client is unaffected.', 'bad')
    await deliver(run, 1, .8)
    say('Attempt 1 fails. The message stays saved and a retry is scheduled.', 'bad')
    await sleep(run, 700)
    await deliver(run, 2, .8)
    say('Attempt 2 fails the same way.', 'bad')
    await sleep(run, 700)
    set('receiver', 'idle', 'Back up')
    delete stops.dispatch.dataset.link
    say('The receiver comes back, and attempt 3 gets through.')
    await deliver(run, 3)
    set('receiver', 'ok', 'Stored the result')
    bump('receipts', 1)
    await travel(run, 'receiver', 'dispatch', { kind: 'reply' })
    set('dispatch', 'ok', 'Delivered')
    printReceipt('Delivered on attempt 3 of 3. Two failures, nothing lost.')
    finish('The outage cost time, not data. If attempts run out, the message waits as Failed until an operator retries it, and that retry goes in the audit log.', 'persistent-operations-testing', 'the persistent operations gate')
  },
  async ack(run) {
    await request(run); await commit(run); await reply(run)
    await sleep(run, 300)
    await deliver(run, 1)
    set('receiver', 'ok', 'Stored the result')
    bump('receipts', 1)
    say('The receiver stores the result and replies.')
    await travel(run, 'receiver', 'dispatch', { kind: 'reply', until: .5 })
    set('dispatch', 'bad', 'Heard nothing')
    say('The reply is lost. The dispatcher cannot tell whether delivery worked.', 'bad')
    await sleep(run, 800)
    say('Its lease expires, so it sends again with the same message ID.')
    await deliver(run, 2)
    set('receiver', 'ok', 'Already had this ID')
    say('The receiver recognises the ID and computes nothing new.')
    await travel(run, 'receiver', 'dispatch', { kind: 'reply' })
    set('dispatch', 'ok', 'Delivered')
    printReceipt('Sent twice. Computed once.')
    finish('Two sends, one effect. The stable message ID and the receiver together make the retry harmless.', 'outbox-testing', 'the outbox gate')
  },
  async crash(run) {
    await request(run)
    await sleep(run, 500)
    say('The transaction has started writing, and SIGKILL hits the process.', 'bad')
    set('tx', 'bad', 'Killed')
    set('client', 'bad', 'No reply')
    await sleep(run, 900)
    say('PostgreSQL rolls the open transaction back. No command, no message, no half-saved row.')
    set('tx', 'idle', 'Rolled back')
    await sleep(run, 800)
    say('The host restarts and the client retries with the same key.')
    await request(run, 'Retrying')
    await commit(run); await reply(run)
    await sleep(run, 300)
    await deliver(run, 1)
    set('receiver', 'ok', 'Stored the result')
    bump('receipts', 1)
    await travel(run, 'receiver', 'dispatch', { kind: 'reply' })
    set('dispatch', 'ok', 'Delivered')
    printReceipt('The killed attempt left nothing behind.')
    finish('Either everything committed or nothing did, so the retry starts clean.', 'transaction-publishing-testing', 'the transaction gate')
  },
  async replay(run) {
    await request(run); await commit(run)
    await travel(run, 'tx', 'client', { kind: 'reply', until: .5 })
    set('client', 'bad', 'Connection dropped')
    say('The reply never reaches the client, which cannot tell whether it saved.', 'bad')
    await sleep(run, 800)
    set('client', 'busy', 'Retrying')
    say('The client retries with the same key create-1.')
    await travel(run, 'client', 'tx')
    set('tx', 'ok', 'Replayed saved reply')
    say('The key is already saved, so the server returns the original reply and creates nothing.')
    await travel(run, 'tx', 'client', { kind: 'reply' })
    set('client', 'ok', 'Same command ID')
    say('Sending different numbers with that key would return 409 instead.')
    await deliver(run, 1)
    set('receiver', 'ok', 'Stored the result')
    bump('receipts', 1)
    await travel(run, 'receiver', 'dispatch', { kind: 'reply' })
    set('dispatch', 'ok', 'Delivered')
    printReceipt('Requested twice. Saved once.')
    finish('The client can always retry. The key makes the second request the same request.', 'idempotency-testing', 'the idempotency gate')
  },
}

async function play(name) {
  const run = ++current
  reset()
  try {
    await sleep(run, 100)
    await scenarios[name](run)
  } catch (error) {
    if (!(error instanceof Superseded)) throw error
  }
}
const selected = () => $('input[name=scenario]:checked').value
for (const radio of $$('input[name=scenario]')) radio.addEventListener('change', () => play(selected()))
$('#replay').addEventListener('click', () => play(selected()))
setTimeout(() => play(selected()), reduced.matches ? 0 : 1300)

/* Runtime tabs: only the host lines change, and those are what gets marked. */
const runtimes = {
  node: { from: '@longhornjs/node', name: 'nodeRuntime', storage: 'SQLite, PostgreSQL and Redis', passwords: 'Native scrypt', limit: 'The complete console is verified on this profile only.' },
  bun: { from: '@longhornjs/bun', name: 'bunRuntime', storage: 'Native bun:sqlite', passwords: 'Native scrypt', limit: 'SQL calls run synchronously.' },
  deno: { from: '@longhornjs/deno', name: 'denoRuntime', storage: 'Built-in SQLite', passwords: 'Native scrypt', limit: 'Launchers grant explicit file, network and environment permissions.' },
  workers: { storage: 'D1 and Durable Object SQLite', passwords: 'No Worker scrypt provider yet', limit: 'Workers owns sockets and lifetime, so you export a handler instead of listening. D1 uses predeclared batches, not callback transactions.' },
}
function esc(text) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;') }
function showRuntime(name, focus) {
  const runtime = runtimes[name], worker = name === 'workers'
  const importLine = worker ? "import { createWorker } from '@longhornjs/workers'" : `import { ${runtime.name} } from '${runtime.from}'`
  const hostLine = worker ? 'export default createWorker(app)' : `await app.listen(${runtime.name}, { port: 3000 })`
  $('#runtime-code').innerHTML = `import { Longhorn } from '@longhornjs/core'\n<span class="changed">${esc(importLine)}</span>\nconst app = new Longhorn()\n\napp.http.get('/health', (c) =&gt; c.json({ status: 'ok' }))\n\n<span class="changed">${esc(hostLine)}</span>`
  $('#fact-storage').textContent = runtime.storage
  $('#fact-passwords').textContent = runtime.passwords
  $('#fact-limit').textContent = runtime.limit
  $('#runtime-panel').setAttribute('aria-labelledby', `tab-${name}`)
  for (const tab of $$('#runtime-tabs [role=tab]')) {
    const active = tab.dataset.runtime === name
    tab.setAttribute('aria-selected', String(active))
    tab.tabIndex = active ? 0 : -1
    if (active && focus) tab.focus()
  }
}
const tabs = $$('#runtime-tabs [role=tab]')
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showRuntime(tab.dataset.runtime))
  tab.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    showRuntime(tabs[(index + step + tabs.length) % tabs.length].dataset.runtime, true)
  })
})
showRuntime('node')

/* Project picker: every command here matches a template in cli/src. */
const templates = {
  api: { runtimes: ['node', 'bun', 'deno', 'workers'], dir: 'my-api', flag: '', after: 'Your API is at http://127.0.0.1:3000/health.' },
  'sqlite-tasks': { runtimes: ['node', 'bun', 'deno'], dir: 'my-tasks', flag: ' --template sqlite-tasks', after: 'Tasks are stored in a file and survive restarts.' },
  'sqlite-auth': { runtimes: ['node', 'bun', 'deno'], dir: 'my-accounts', flag: ' --template sqlite-auth', after: 'See docs/ in the project for sign-up and sign-in commands.' },
  'd1-tasks': { runtimes: ['workers'], dir: 'my-d1-api', flag: ' --template d1-tasks', after: 'Runs on local workerd with retained D1 data. Deploying to Cloudflare is your next step.' },
  'command-app': { runtimes: ['node'], dir: 'my-console', flag: ' --template command-app', setup: true, after: 'This one needs PostgreSQL and a receiver. Follow docs/setup.md in the project before starting it.' },
}
let templateName = 'api', runtimeName = 'node'
const runtimeLabel = { node: 'Node', bun: 'Bun', deno: 'Deno', workers: 'Workers' }
function startCommands() {
  const template = templates[templateName]
  return ['git clone https://github.com/MirHamzaHasan/longhorn.git', 'cd longhorn', 'pnpm install', `pnpm create:app ../${template.dir} --runtime ${runtimeName}${template.flag}`, `cd ../${template.dir}`, 'pnpm install', ...(template.setup ? ['pnpm build'] : ['pnpm dev'])].join('\n')
}
function showStart() {
  const template = templates[templateName]
  if (!template.runtimes.includes(runtimeName)) runtimeName = template.runtimes[0]
  const group = $('#runtime-choice')
  group.textContent = ''
  for (const name of template.runtimes) {
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(name === runtimeName))
    button.textContent = runtimeLabel[name]
    button.addEventListener('click', () => { runtimeName = name; showStart(); $('#runtime-choice [aria-checked=true]').focus() })
    group.append(button)
  }
  $('#start-code').textContent = startCommands()
  $('#start-note').textContent = template.after
  $('#copy').textContent = 'Copy commands'
}
for (const radio of $$('input[name=template]')) radio.addEventListener('change', () => { templateName = radio.value; showStart() })
$('#copy').addEventListener('click', async (event) => {
  try {
    await navigator.clipboard.writeText(startCommands())
    event.target.textContent = 'Copied'
  } catch {
    event.target.textContent = 'Select the text to copy'
  }
})
showStart()

/* The line down the page's margin tracks how far the reader has come. */
const trail = $('.trail')
let queued = false
function trace() {
  queued = false
  const span = document.documentElement.scrollHeight - innerHeight
  trail.style.setProperty('--progress', span > 0 ? Math.min(1, scrollY / span).toFixed(4) : '0')
}
addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(trace) } }, { passive: true })
addEventListener('resize', trace)
trace()
