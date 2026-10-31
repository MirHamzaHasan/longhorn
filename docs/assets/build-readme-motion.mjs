// Builds the README's motion pieces: film, hosts, stack, failures and quickstart, and their -still.svg twins.
// See docs/website.md. Needs opentype.js and the @fontsource fonts in a folder of your choice:
//   npm install --prefix <folder> opentype.js @fontsource/geist-sans @fontsource/geist-mono
//   node docs/assets/build-readme-motion.mjs <folder>
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const vendor = process.argv[2]
if (!vendor) throw new Error('Usage: node docs/assets/build-readme-motion.mjs <folder with the fonts>')
const out = dirname(fileURLToPath(import.meta.url))
const opentype = createRequire(join(vendor, 'package.json'))('opentype.js')
const font = (name) => opentype.loadSync(join(vendor, 'node_modules/@fontsource', name))
const display = font('geist-sans/files/geist-sans-latin-600-normal.woff')
const body = font('geist-sans/files/geist-sans-latin-400-normal.woff')
const mono = font('geist-mono/files/geist-mono-latin-400-normal.woff')

const C = { ground: '#0c0e12', panel: '#14171d', deep: '#1a1e26', wire: '#c9d1dc', faint: '#2b313b', chalk: '#f2f4f7', muted: '#98a1ae', iron: '#ffb224', flare: '#ff7a68', ok: '#3dd68c', paper: '#f5f3ec', ink: '#14171d', cyan: '#0c0e12' }
const EASE = { decel: '0,0,.2,1', emph: '.16,1,.3,1', inout: '.76,0,.24,1', exit: '.4,0,1,1', linear: '0,0,1,1' }

// Mono has no kerning, so its glyphs are shared with <use>, which keeps the code panels small.
const glyphs = new Map()
const glyph = (ch) => {
  if (!glyphs.has(ch)) glyphs.set(ch, { id: `m${glyphs.size}`, d: mono.charToGlyph(ch).getPath(0, 0, 100).toPathData(1) })
  return glyphs.get(ch).id
}
const monoText = (s, x, y, size, fill) => {
  const step = mono.getAdvanceWidth('x', 100)
  return `<g fill="${fill}" transform="translate(${+x.toFixed(1)} ${y}) scale(${size / 100})">${[...s].map((ch, i) => (ch === ' ' ? '' : `<use href="#${glyph(ch)}" x="${+(i * step).toFixed(1)}"/>`)).join('')}</g>`
}
// Headlines are set slightly tight, as large sans type needs.
const spacing = (f) => ({ letterSpacing: f === display ? -0.022 : 0 })
const text = (f, s, x, y, size, fill) => (f === mono ? monoText(s, x, y, size, fill) : `<path fill="${fill}" d="${f.getPath(s, x, y, size, spacing(f)).toPathData(1)}"/>`)
const width = (f, s, size) => f.getAdvanceWidth(s, size, spacing(f))

// One timeline per object, so no two animations fight over an element. A frame holds its pose
// until the next frame's start, then moves there over `in` seconds on `ease`.
function film(name, W, H, title, DUR, REST) {
  const tracks = []
  const pose = (p) => `transform:translate(${p.x ?? 0}px,${p.y ?? 0}px) scale(${p.s ?? 1});opacity:${p.o ?? 1}${p.d === undefined ? '' : `;stroke-dashoffset:${p.d}`}`
  return {
    /** keys: [time the move ends, pose, seconds it takes, curve]. The first key is the start pose. */
    track(id, keys) { tracks.push({ id, keys }); return id },
    /** `loops` is CSS for pulses that repeat on their own clock; the still keeps their resting frame. */
    write(content, loops = '') {
      const moving = tracks.map(({ id, keys }) => {
        const stops = [[0, keys[0][1]]]
        const curves = new Map()
        for (const [end, p, secs = 0.0001, ease = 'emph'] of keys.slice(1)) {
          const start = end - secs, last = stops.at(-1)
          if (start > last[0] + 1e-6) stops.push([start, last[1]])
          curves.set(stops.at(-1)[0], ease)
          stops.push([end, { ...stops.at(-1)[1], ...p }])
        }
        if (stops.at(-1)[0] < DUR) stops.push([DUR, stops.at(-1)[1]])
        const css = stops.map(([t, p]) => `${+(t / DUR * 100).toFixed(3)}%{${pose(p)};animation-timing-function:cubic-bezier(${EASE[curves.get(t) ?? 'linear']})}`).join('')
        return { id, css, rest: stops.filter(([t]) => t <= REST).at(-1)[1] }
      })
      const still = moving.map((m) => `.${m.id}{${pose(m.rest)}}`).join('')
      const live = `${still}${moving.map((m) => `.${m.id}{animation:${m.id} ${DUR}s linear infinite}@keyframes ${m.id}{${m.css}}`).join('')}${loops}`
      const defs = `<defs>${[...glyphs.values()].map((g) => `<path id="${g.id}" d="${g.d}"/>`).join('')}</defs>`
      glyphs.clear()
      const doc = (style) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title}"><title>${title}</title><style>${style}</style>${defs}${content}</svg>\n`
      writeFileSync(join(out, `${name}.svg`), doc(live))
      writeFileSync(join(out, `${name}-still.svg`), doc(still))
    },
  }
}

const ground = (W, H) => `<defs><pattern id="g" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#fff" fill-opacity=".07"/></pattern></defs><rect width="${W}" height="${H}" fill="${C.ground}"/><rect width="${W}" height="${H}" fill="url(#g)"/>`

/* One take in one window: the server log on the left, the database on the right. The log dies. The rows don't. */
{
  const W = 1280, H = 720, DUR = 30, REST = 28
  const f = film('film', W, H, 'One continuous animation of an app window, with a server log on the left and the database on the right. A command for the numbers 4, 8 and 15 is saved with its message in one transaction. kill -9 ends the process and the log goes dark, while both database rows stay. After a restart, two delivery attempts fail while the receiver is down. The third lands, the message is marked delivered and one receipt prints: count 3, sum 27, minimum 4, maximum 15. Write the backend once. Keep the work when the process dies.', DUR, REST)
  const WX = 64, WY = 152, WW = 1152, WH = 536, SPLIT = 716
  f.track('all', [[0, { o: 1 }], [29.6, { o: 0 }, 0.28, 'exit']])

  // The crash: one flash and one shake, because this is the only violent moment in the take.
  const KILL = 8.2
  f.track('flash', [[0, { o: 0 }], [KILL, { o: 0.4 }, 0.02, 'exit'], [KILL + 0.3, { o: 0 }, 0.28, 'decel']])
  f.track('shake', [[0, { x: 0 }], [KILL + 0.03, { x: 12 }, 0.03, 'linear'], [KILL + 0.09, { x: -9 }, 0.06, 'linear'], [KILL + 0.16, { x: 6 }, 0.07, 'linear'], [KILL + 0.23, { x: -2 }, 0.07, 'linear'], [KILL + 0.29, { x: 0 }, 0.06, 'linear']])
  f.track('dead', [[0, { o: 0 }], [KILL + 0.04, { o: 0.8 }, 0.04, 'exit'], [11.4, { o: 0 }, 0.4, 'decel']])
  f.track('kill', [[0, { o: 0, s: 1.08, x: (WX + SPLIT) / 2, y: 640 }], [KILL + 0.1, { o: 1, s: 1 }, 0.1, 'exit'], [10.9, { o: 0 }, 0.26, 'exit']])

  // The log prints line by line, on real line slots.
  const LX = WX + 28, LY = 232, LH = 34.5, LS = 23
  const log = [
    [0.5, '$ pnpm start', C.chalk], [1.1, 'listening on :3000', C.muted],
    [3.1, 'POST /commands  4, 8, 15', C.chalk],
    [4.9, 'BEGIN', C.muted], [5.2, '  INSERT command', C.chalk], [5.8, '  INSERT outbox message', C.chalk], [6.6, 'COMMIT', C.iron],
    [11.6, '$ pnpm start', C.chalk], [12.3, 'outbox: 1 message pending', C.muted],
    [13.6, 'attempt 1  receiver down', C.flare], [16, 'attempt 2  receiver down', C.flare], [18.4, 'attempt 3  delivered', C.ok],
  ]
  const lineY = (i) => LY + i * LH
  const lines = log.map(([t, s, tone], i) => {
    const slot = i >= 7 ? i + 1 : i
    f.track(`l${i}`, [[0, { o: 0, y: 6 }], [t + 0.24, { o: 1, y: 0 }, 0.24, 'decel']])
    return `<g class="l${i}">${text(mono, s, LX, lineY(slot), LS, tone)}</g>`
  }).join('')
  f.track('died', [[0, { o: 0 }], [KILL + 0.06, { o: 1 }, 0.04, 'exit']])
  const died = `<g class="died">${text(mono, 'zsh: killed  pnpm start', LX, lineY(7), LS, C.flare)}</g>`

  // The database rows. Pills change word in one slot.
  const RX = SPLIT + 24, RW = WX + WW - RX - 24, R1 = 216, R2 = 286, RH = 58
  const pill = (id, s, tone, row, keys) => {
    f.track(id, keys)
    const w = width(mono, s, 19) + 26, x = RX + 138, y = row + RH / 2
    return `<g class="${id}"><rect x="${x}" y="${y - 15}" width="${w}" height="30" rx="15" fill="${tone}" fill-opacity=".16"/>${text(mono, s, x + 13, y + 7, 19, tone)}</g>`
  }
  const swapPill = (on, off) => [[0, { o: 0 }], [on, { o: 1 }, 0.24, 'decel'], ...(off ? [[off, { o: 0 }, 0.14, 'exit']] : [])]
  const row = (y, label) => `<rect x="${RX}" y="${y}" width="${RW}" height="${RH}" rx="10" fill="${C.deep}" stroke="${C.faint}"/>${text(mono, label, RX + 16, y + RH / 2 + 7, 21, C.muted)}`
  f.track('commit', [[0, { o: 0 }], [6.84, { o: 1 }, 0.3, 'decel']])
  const pills = [
    pill('p0', 'saved', C.ok, R1, swapPill(6.9)),
    pill('p1', 'pending', C.iron, R2, swapPill(6.9, 13.6)),
    pill('p2', 'retry 1', C.flare, R2, swapPill(13.84, 16)),
    pill('p3', 'retry 2', C.flare, R2, swapPill(16.24, 18.4)),
    pill('p4', 'delivered', C.ok, R2, swapPill(18.64)),
  ].join('')

  // The receipt prints into the pane, and the chip's numbers become its first line.
  const PT = 372, PH = 288, rows = [['Numbers', '4, 8, 15'], ['Count', '3'], ['Sum', '27'], ['Minimum', '4'], ['Maximum', '15']], RS = 24
  f.track('paper', [[0, { y: -PH - 8 }], [19.6, { y: 0 }, 0.8, 'emph']])
  f.track('v0', [[0, { o: 0 }], [20.12, { o: 1 }]])
  f.track('t0', [[0, { o: 0, y: 8 }], [20.3, { o: 1, y: 0 }, 0.36, 'decel']])
  rows.slice(1).forEach((_, i) => f.track(`t${i + 1}`, [[0, { o: 0, y: 10 }], [20.5 + i * 0.07, { o: 1, y: 0 }, 0.36, 'decel']]))
  const rowY = (i) => PT + 58 + i * 48
  const receipt = `<clipPath id="well"><rect x="${RX - 2}" y="${PT}" width="${RW + 4}" height="${PH + 4}"/></clipPath><g clip-path="url(#well)"><g class="paper"><rect x="${RX}" y="${PT}" width="${RW}" height="${PH}" rx="10" fill="${C.paper}"/></g>${rows.map(([a, b], i) => { const label = text(mono, a, RX + 22, rowY(i), RS, C.ink), value = text(mono, b, RX + RW - 22 - width(mono, b, RS), rowY(i), RS, C.ink); return i ? `<g class="t${i}">${label}${value}</g>` : `<g class="t0">${label}</g><g class="v0">${value}</g>` }).join('')}</g>`

  // The hero: the numbers leave the log, become rows and end on the receipt.
  const CS = 21, chip = (cls) => { const w = width(mono, '4, 8, 15', CS) + 22; return `<g class="${cls}"><rect x="${-w / 2}" y="-17" width="${w}" height="34" rx="8" fill="${C.iron}"/>${text(mono, '4, 8, 15', -width(mono, '4, 8, 15', CS) / 2, 7, CS, C.ink)}</g>` }
  const SLOT = RX + RW - 78, FROM = { x: LX + 400, y: lineY(2) - 8 }
  const LAND = { x: RX + RW - 22 - width(mono, '4, 8, 15', RS) / 2, y: rowY(0) - 8, s: RS / CS }
  f.track('cmd', [[0, { ...FROM, o: 0, s: 0.9 }], [3.8, { o: 1, s: 1 }, 0.4, 'decel'], [5.5, { x: SLOT, y: R1 + RH / 2 }, 0.8, 'inout']])
  f.track('msg', [[0, { x: LX + 400, y: lineY(5) - 8, o: 0, s: 0.9 }], [5.95, { o: 1, s: 1 }, 0.2, 'decel'], [6.6, { x: SLOT, y: R2 + RH / 2 }, 0.62, 'inout'], [20.12, LAND, 0.72, 'inout'], [20.3, { o: 0 }, 0.16, 'exit']])

  // The process state sits in the title bar and changes word in one slot.
  const state = (id, s, tone, keys) => { f.track(id, keys); const w = width(mono, s, 19); return `<g class="${id}"><circle cx="${WX + WW - w - 42}" cy="${WY + 25}" r="6" fill="${tone}"/>${text(mono, s, WX + WW - w - 24, WY + 32, 19, tone)}</g>` }
  const states = state('s0', 'running', C.ok, [[0, { o: 1 }], [KILL, { o: 0 }, 0.04, 'exit'], [11.7, { o: 1 }, 0.3, 'decel']]) + state('s1', 'killed', C.flare, [[0, { o: 0 }], [KILL + 0.02, { o: 1 }, 0.04, 'exit'], [11.4, { o: 0 }, 0.2, 'exit']])

  // Words change in one centred slot: the old ones lift out, the new ones rise in.
  const CX = W / 2, say = (id, parts, start, end) => {
    const keys = [[0, { o: 0, y: 16 }], [start + 0.36, { o: 1, y: 0 }, 0.46, 'decel']]
    if (end) keys.push([end, { o: 0, y: -12 }, 0.22, 'exit'])
    f.track(id, keys)
    const size = 60, base = parts.length > 1 ? 58 : 112
    return `<g class="${id}">${parts.map(([s, tone], i) => text(display, s, CX - width(display, s, size) / 2, base + i * 64, size, tone)).join('')}</g>`
  }
  const words = [
    say('w0', [['Your process will die.', C.chalk]], -0.1, 2.6),
    say('w1', [['A command arrives.', C.chalk]], 2.65, 4.5),
    say('w2', [['Saved with its message, in one transaction.', C.chalk]], 4.55, 8.1),
    say('w3', [['The process is gone.', C.flare]], 7.85, 9.9),
    say('w4', [['Both rows are still there.', C.chalk]], 9.95, 13.2),
    say('w5', [['Attempt 1 fails. Still saved.', C.flare]], 13.25, 15.6),
    say('w6', [['Attempt 2 fails. Still saved.', C.flare]], 15.65, 18),
    say('w7', [['Attempt 3 lands. One receipt.', C.iron]], 18.05, 22.4),
    say('w8', [['Write the backend once.', C.chalk], ['Keep the work when the process dies.', C.iron]], 22.45),
  ].join('')

  const horns = ['M46 27C33 29 19 27 11 19 7 15 4 9 3 3', 'M74 27C87 29 101 27 109 19 113 15 116 9 117 3', 'M46 27Q60 20 74 27L68 54Q60 62 52 54Z']
  const mark = `<g transform="translate(${WX + 20} ${WY + 15}) scale(.32)">${horns.map((d) => `<path d="${d}" fill="none" stroke="${C.iron}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g>${text(body, 'LongHorn', WX + 66, WY + 32, 21, C.chalk)}`

  f.write(`${ground(W, H)}<g class="shake"><g class="all">
    <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="14" fill="${C.panel}" stroke="${C.faint}"/>
    <path d="M${WX} ${WY + 50}H${WX + WW}M${SPLIT} ${WY + 50}V${WY + WH}" stroke="${C.faint}"/>
    ${mark}${states}
    ${lines}
    <rect class="dead" x="${WX + 1}" y="${WY + 51}" width="${SPLIT - WX - 1}" height="${WH - 52}" fill="${C.ground}"/>
    ${died}
    ${row(R1, 'command')}${row(R2, 'message')}
    <rect class="commit" x="${RX - 8}" y="${R1 - 8}" width="${RW + 16}" height="${R2 + RH - R1 + 16}" rx="14" fill="none" stroke="${C.iron}" stroke-width="2.5"/>
    ${pills}${receipt}${chip('cmd')}${chip('msg')}
    <g class="kill">${text(mono, 'kill -9', -width(mono, 'kill -9', 76) / 2, 26, 76, C.flare)}</g>
    <rect class="flash" width="${W}" height="${H}" fill="${C.flare}"/>
    ${words}
  </g></g>`)
}

/* The same app on every host: only the import and the last line change. */
{
  const W = 1280, H = 548, DUR = 16, REST = 1.6
  const f = film('hosts', W, H, 'The same LongHorn app on four hosts. Changing the import and the last line moves it from Node to Bun, Deno and Workers, and its health route reports each runtime.', DUR, REST)
  const hosts = [
    { name: 'Node', imp: "import { nodeRuntime } from '@longhorn/node'", last: 'await app.listen(nodeRuntime)', rt: 'node' },
    { name: 'Bun', imp: "import { bunRuntime } from '@longhorn/bun'", last: 'await app.listen(bunRuntime)', rt: 'bun' },
    { name: 'Deno', imp: "import { denoRuntime } from '@longhorn/deno'", last: 'await app.listen(denoRuntime)', rt: 'deno' },
    { name: 'Workers', imp: "import { createWorker } from '@longhorn/workers'", last: 'export default createWorker(app)', rt: 'workers' },
  ]
  const SIZE = 29, LX = 64, step = 4, EX = 0.24, IN = 0.52
  const swap = (id, i, content) => {
    const on = i * step
    const keys = i === 0
      ? [[0, { o: 1, y: 0 }], [step - 0.3, { o: 0, y: -12 }, EX, 'exit'], [DUR, { o: 1, y: 0 }, IN, 'decel']]
      : [[0, { o: 0, y: 18 }], [on - 0.3 + 0.06 + IN, { o: 1, y: 0 }, IN, 'decel'], [on + step - 0.3, { o: 0, y: -12 }, EX, 'exit'], [on + step, { y: 18 }]]
    f.track(id, keys)
    return `<g class="${id}">${content}</g>`
  }
  const code = (s, y, fill) => text(mono, s, LX + 32, y, SIZE, fill)
  const panelY = 90, rowH = 44
  const y = (n) => panelY + 46 + n * rowH
  const lines = hosts.map((h, i) => swap(`i${i}`, i, code(h.imp, y(1), C.iron)) + swap(`l${i}`, i, code(h.last, y(4), C.iron)) + swap(`r${i}`, i, text(mono, `{"status":"ok","runtime":"${h.rt}","ready":true}`, LX + 240, 388, SIZE, C.chalk))).join('')
  const slots = hosts.map((_, i) => 64 + i * 288)
  f.track('rail', [[0, { x: slots[0] }], ...hosts.slice(1).map((_, i) => [(i + 1) * step + 0.3, { x: slots[i + 1] }, 0.8, 'inout']), [DUR + 0, { x: slots[0] }, 0.8, 'inout']])
  f.write(`${ground(W, H)}
    ${text(display, 'Change the host. Keep the app.', 64, 66, 52, C.chalk)}
    <rect x="${LX}" y="${panelY}" width="${W - 128}" height="${rowH * 5 + 24}" rx="12" fill="${C.deep}" stroke="${C.faint}"/>
    ${code("import { Longhorn } from '@longhorn/core'", y(0), C.muted)}
    ${code('const app = new Longhorn()', y(2), C.muted)}
    ${code("app.http.get('/health', health)", y(3), C.muted)}
    <rect x="${LX}" y="350" width="${W - 128}" height="58" rx="12" fill="${C.ground}" stroke="${C.faint}"/>
    ${code('GET /health', 388, C.muted)}
    ${lines}
    ${hosts.map((h, i) => text(display, h.name, slots[i], 474, 42, C.chalk)).join('')}
    <path d="M64 506H1216" stroke="${C.wire}" stroke-width="2.5"/>
    <g class="rail"><rect y="-3" x="0" width="${288 - 40}" height="9" rx="4.5" fill="${C.iron}" transform="translate(0 506)"/></g>`)
}

/* Which modules real applications import, read from their package.json files. */
{
  const W = 1280, H = 690, step = 5, DUR = 20, REST = 19
  const apps = [
    { name: 'Tasks API', dir: 'basic', hosts: ['Node'] },
    { name: 'Accounts', dir: 'auth', hosts: ['Node', 'Bun', 'Deno'] },
    { name: 'Worker on D1', dir: 'd1-worker', hosts: ['Workers'] },
    { name: 'Command app', dir: 'postgres', hosts: ['Node'] },
  ].map((app) => {
    const pkg = JSON.parse(readFileSync(join(out, '../../examples', app.dir, 'package.json'), 'utf8'))
    return { ...app, uses: new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((k) => k.startsWith('@longhorn/')).map((k) => k.slice(10))) }
  })
  const f = film('stack', W, H, 'Four real example applications and the modules each one imports. A tasks API, accounts, a Worker on D1 and the command app each light up a different set of optional modules on top of the same core, on the hosts they run on.', DUR, REST)
  const optional = ['validation', 'config', 'database', 'auth', 'events', 'cache', 'queue', 'scheduler', 'idempotency', 'ratelimit', 'outbox', 'observability']
  const core = ['core', 'container', 'http', 'runtime', 'logger'], hosts = ['Node', 'Bun', 'Deno', 'Workers']
  const LX = 64, FULL = W - 128, GAP = 10
  // Each tile keeps one overlay on one timeline; it only moves when the next app changes its state.
  const tile = (id, label, x, y, w, h, on, f2 = mono, size = 26) => {
    const center = (fill) => text(f2, label, x + (w - width(f2, label, size)) / 2, y + h / 2 + size * 0.34, size, fill)
    const base = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.faint}"/>${center(C.muted)}`
    if (on === true) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C.deep}" stroke="${C.wire}"/>${center(C.chalk)}`
    const pose = (state) => ({ o: state ? 1 : 0, y: state ? 0 : 8 })
    const keys = [[0, pose(on[0])]]
    on.slice(1).forEach((state, i) => { if (state !== on[i]) keys.push([(i + 1) * step + 0.5, pose(state), 0.36, state ? 'decel' : 'exit']) })
    if (on.at(-1) !== on[0]) keys.push([DUR, pose(on[0]), 0.36, on[0] ? 'decel' : 'exit'])
    if (keys.length > 1) f.track(id, keys)
    return `${base}<g class="${id}"${keys.length > 1 ? '' : ` opacity="${on[0] ? 1 : 0}"`}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C.iron}"/>${center(C.ink)}</g>`
  }
  const size = (n) => (FULL - GAP * (n - 1)) / n
  const label = (s, y) => text(body, s, LX, y, 27, C.muted)
  const row = (names, y, h, on, prefix, f2, fs) => names.map((n, i) => tile(`${prefix}${i}`, n, LX + i * (size(names.length) + GAP), y, size(names.length), h, on(n), f2, fs)).join('')
  const opt1 = optional.slice(0, 6), opt2 = optional.slice(6)
  const lit = (n) => apps.map((a) => a.uses.has(n))
  const swaps = apps.map((a, i) => {
    const on = i * step, id = `a${i}`
    const keys = i === 0
      ? [[0, { o: 1, y: 0 }], [step + 0.24, { o: 0, y: -12 }, 0.24, 'exit'], [DUR, { o: 1, y: 0 }, 0.5, 'decel']]
      : [[0, { o: 0, y: 18 }], [on + 0.8, { o: 1, y: 0 }, 0.5, 'decel'], ...(i < apps.length - 1 ? [[on + step + 0.24, { o: 0, y: -12 }, 0.24, 'exit']] : [[DUR - 0.26, { o: 0, y: -12 }, 0.24, 'exit']])]
    f.track(id, keys)
    return `<g class="${id}">${text(display, a.name, LX + 28, 191, 42, C.iron)}${text(mono, `examples/${a.dir}`, W - LX - 28 - width(mono, `examples/${a.dir}`, 28), 190, 28, C.muted)}</g>`
  }).join('')
  f.write(`${ground(W, H)}
    ${text(display, 'Import what you use. Nothing else starts.', LX, 84, 52, C.chalk)}
    <rect x="${LX}" y="130" width="${FULL}" height="92" rx="12" fill="${C.panel}" stroke="${C.faint}"/>${swaps}
    ${label('Optional modules, wired by your application', 268)}
    ${row(opt1, 282, 66, lit, 'p', mono, 22)}
    ${row(opt2, 358, 66, lit, 'q', mono, 22)}
    ${label('Core, always there', 466)}
    ${row(core, 480, 56, () => true, 'c', mono, 26)}
    ${label('The host it runs on', 576)}
    ${row(hosts, 590, 70, (n) => apps.map((a) => a.hosts.includes(n)), 'h', display, 30)}`)
}

/* Four failures in turn, each from the table under this piece. One scene plays while the others wait. */
{
  const W = 1280, H = 760, CW = 580, CH = 344, MX = 48, GAP = 24, SLOT = 6, DUR = 28, END = 27.5, REST = 27
  const f = film('failures', W, H, 'Four failures, one after another. The receiver is down: the message stays saved and lands on a later attempt. A delivery reply is lost: it is sent twice and stored once. The process dies mid-commit: the transaction rolls back and leaves no partial writes. The client never hears back: it retries with the same key and gets the original reply.', DUR, REST)
  const AX = 96, BX = 484, MY = 158
  const line = (x1, x2, extra = '') => `<path d="M${x1} ${MY}H${x2}" stroke="${C.wire}" stroke-width="3"${extra}/>`
  const dot = (x, s) => `<circle cx="${x}" cy="${MY}" r="13" fill="${C.chalk}"/>${text(body, s, x - width(body, s, 24) / 2, MY + 48, 24, C.chalk)}`
  const chip = (id, s) => { const w = width(mono, s, 26) + 28; return `<g class="${id}"><rect x="${-w / 2}" y="-22" width="${w}" height="44" rx="8" fill="${C.iron}"/>${text(mono, s, -width(mono, s, 26) / 2, 9, 26, C.ink)}</g>` }
  const cross = (id, x) => `<g class="${id}"><path d="M${x - 13} ${MY - 16}l26 32M${x + 13} ${MY - 16}l-26 32" stroke="${C.flare}" stroke-width="5" stroke-linecap="round"/></g>`
  const reset = (pose) => [END, pose, 0.3, 'exit']
  const scene = (slot, title, result, draw) => {
    const x = MX + (slot % 2) * (CW + GAP * 2 - 24 + 24), y = 28 + (slot >> 1) * (CH + GAP), t0 = slot * SLOT, id = `s${slot}`
    f.track(`${id}dim`, slot === 0
      ? [[0, { o: 0 }], [SLOT + 0.3, { o: 0.62 }, 0.3, 'decel'], [SLOT * 4 + 0.3, { o: 0 }, 0.4, 'decel']]
      : [[0, { o: 0.62 }], [t0 + 0.3, { o: 0 }, 0.3, 'decel'], ...(slot < 3 ? [[t0 + SLOT + 0.3, { o: 0.62 }, 0.3, 'decel'], [SLOT * 4 + 0.3, { o: 0 }, 0.4, 'decel']] : []), [DUR, { o: 0.62 }, 0.3, 'decel']])
    f.track(`${id}res`, [[0, { o: 0, y: 14 }], [t0 + 5.3, { o: 1, y: 0 }, 0.5, 'decel'], reset({ o: 0, y: 14 })])
    return `<g transform="translate(${x} ${y})"><rect width="${CW}" height="${CH}" rx="14" fill="${C.panel}" stroke="${C.faint}"/>${text(display, title, 28, 56, 34, C.chalk)}${draw(t0)}<g class="${id}res">${text(display, result, 28, CH - 30, 30, C.iron)}</g><rect class="${id}dim" width="${CW}" height="${CH}" rx="14" fill="${C.ground}"/></g>`
  }
  const scenes = [
    scene(0, 'The receiver is down', 'Saved. Lands on attempt 3.', (t) => {
      const fail = BX - 96
      f.track('a1', [[0, { x: AX, y: MY, o: 0 }], [t + 0.8, { o: 1 }, 0.3, 'decel'], [t + 1.6, { x: fail }, 0.6, 'inout'], [t + 2.1, { x: AX }, 0.4, 'inout'], [t + 3, { x: fail }, 0.6, 'inout'], [t + 3.5, { x: AX }, 0.4, 'inout'], [t + 4.6, { x: BX }, 0.7, 'inout'], [t + 4.8, { o: 0 }, 0.2, 'exit']])
      f.track('a2', [[0, { o: 0 }], [t + 1.62, { o: 1 }, 0.08, 'decel'], [t + 1.95, { o: 0 }, 0.2, 'exit'], [t + 3.02, { o: 1 }, 0.08, 'decel'], [t + 3.35, { o: 0 }, 0.2, 'exit']])
      f.track('a3', [[0, { o: 1 }], [t + 3.95, { o: 0 }, 0.3, 'decel'], [DUR, { o: 1 }, 0.3, 'decel']])
      return `${line(AX, BX)}<g class="a3"><path d="M${AX + 18} ${MY}H${BX}" stroke="${C.panel}" stroke-width="7"/><path d="M${AX + 18} ${MY}H${BX}" stroke="${C.flare}" stroke-width="3" stroke-dasharray="10 10"/></g>${dot(AX, 'Outbox')}${dot(BX, 'Receiver')}<g class="a3"><circle cx="${BX}" cy="${MY}" r="14" fill="${C.flare}"/></g>${cross('a2', fail + 72)}${chip('a1', 'msg')}`
    }),
    scene(1, 'The reply is lost', 'Sent twice. Stored once.', (t) => {
      const mid = (AX + BX) / 2
      f.track('b1', [[0, { x: AX, y: MY, o: 0 }], [t + 0.8, { o: 1 }, 0.3, 'decel'], [t + 1.6, { x: BX }, 0.7, 'inout'], [t + 1.8, { o: 0 }, 0.2, 'exit'], [t + 3, { x: AX }], [t + 3.2, { o: 1 }, 0.2, 'decel'], [t + 4.1, { x: BX }, 0.7, 'inout'], [t + 4.3, { o: 0 }, 0.2, 'exit']])
      f.track('b2', [[0, { x: BX, y: MY, o: 0 }], [t + 1.85, { o: 1 }, 0.1, 'decel'], [t + 2.35, { x: mid }, 0.45, 'inout'], [t + 2.55, { o: 0 }, 0.2, 'exit'], [t + 4.35, { x: BX }], [t + 4.45, { o: 1 }, 0.1, 'decel'], [t + 5.1, { x: AX }, 0.6, 'inout'], [t + 5.3, { o: 0 }, 0.2, 'exit']])
      f.track('b3', [[0, { o: 0 }], [t + 2.37, { o: 1 }, 0.08, 'decel'], [t + 2.8, { o: 0 }, 0.25, 'exit']])
      f.track('b4', [[0, { o: 0 }], [t + 1.8, { o: 1 }, 0.2, 'decel'], reset({ o: 0 })])
      const r = 'results: 1'
      return `${line(AX, BX)}${dot(AX, 'Sender')}${dot(BX, 'Receiver')}${cross('b3', mid)}<g class="b4">${text(mono, r, BX - width(mono, r, 24) / 2 - 6, MY - 34, 24, C.chalk)}</g><g class="b2"><circle r="10" fill="${C.chalk}"/></g>${chip('b1', 'id 7')}`
    }),
    scene(2, 'The process dies mid-commit', 'Rolled back. No partial writes.', (t) => {
      const VX = 290, S1 = MY - 2, VY = MY - 62
      f.track('c1', [[0, { x: AX - 20, y: S1, o: 0 }], [t + 0.8, { o: 1 }, 0.3, 'decel'], [t + 1.6, { x: VX - 86 }, 0.7, 'inout'], [t + 3.5, { o: 0, s: 0.92 }, 0.3, 'exit'], reset({ x: AX - 20, s: 1 })])
      f.track('c2', [[0, { x: AX - 20, y: S1, o: 0 }], [t + 1.8, { o: 1 }, 0.2, 'decel'], [t + 2.5, { x: VX + 60 }, 0.6, 'inout'], [t + 3.5, { o: 0, s: 0.92 }, 0.3, 'exit'], reset({ x: AX - 20, s: 1 })])
      f.track('c3', [[0, { o: 0, s: 1.1, x: 290, y: MY + 100 }], [t + 2.72, { o: 1, s: 1 }, 0.1, 'exit'], [t + 4.8, { o: 0 }, 0.3, 'exit']])
      f.track('c4', [[0, { o: 0 }], [t + 2.74, { o: 0.45 }, 0.04, 'exit'], [t + 4.2, { o: 0 }, 0.5, 'decel']])
      return `${line(0, CW)}<rect x="${VX - 190}" y="${VY}" width="380" height="120" rx="12" fill="${C.deep}" stroke="${C.faint}" stroke-width="2"/>${chip('c1', 'command')}${chip('c2', 'message')}<rect class="c4" width="${CW}" height="${CH}" rx="14" fill="${C.ground}"/><g class="c3">${text(mono, 'kill -9', -width(mono, 'kill -9', 34) / 2, 0, 34, C.flare)}</g>`
    }),
    scene(3, 'The client hears nothing', 'Same key. Original reply.', (t) => {
      const mid = (AX + BX) / 2
      f.track('d1', [[0, { x: AX, y: MY, o: 0 }], [t + 0.8, { o: 1 }, 0.3, 'decel'], [t + 1.6, { x: BX }, 0.7, 'inout'], [t + 1.8, { o: 0 }, 0.2, 'exit'], [t + 3, { x: AX }], [t + 3.2, { o: 1 }, 0.2, 'decel'], [t + 4.1, { x: BX }, 0.7, 'inout'], [t + 4.3, { o: 0 }, 0.2, 'exit']])
      f.track('d2', [[0, { x: BX, y: MY, o: 0 }], [t + 1.85, { o: 1 }, 0.1, 'decel'], [t + 2.35, { x: mid }, 0.45, 'inout'], [t + 2.55, { o: 0 }, 0.2, 'exit'], [t + 4.35, { x: BX }], [t + 4.45, { o: 1 }, 0.1, 'decel'], [t + 5.1, { x: AX }, 0.6, 'inout'], [t + 5.3, { o: 0 }, 0.2, 'exit']])
      f.track('d3', [[0, { o: 0 }], [t + 2.37, { o: 1 }, 0.08, 'decel'], [t + 2.8, { o: 0 }, 0.25, 'exit']])
      f.track('d4', [[0, { o: 0 }], [t + 1.8, { o: 1 }, 0.2, 'decel'], reset({ o: 0 })])
      const r = 'ran once'
      return `${line(AX, BX)}${dot(AX, 'Client')}${dot(BX, 'Server')}${cross('d3', mid)}<g class="d4">${text(mono, r, BX - width(mono, r, 24) / 2 - 6, MY - 34, 24, C.chalk)}</g><g class="d2"><circle r="10" fill="${C.chalk}"/></g>${chip('d1', 'key a1')}`
    }),
  ]
  f.write(`${ground(W, H)}${scenes.join('')}`)
}

/* The terminal session: real commands, typed in order, ending on the real health reply. */
{
  const W = 1280, H = 560, DUR = 16, REST = 15
  const f = film('quickstart', W, H, 'A terminal session: clone LongHorn, install, create an app with pnpm create:app, start it, and curl its health route, which returns status ok.', DUR, REST)
  const WX = 64, WY = 36, WW = 1152, WH = 488, X = WX + 32, S = 27
  const rows = [
    ['git clone https://github.com/MirHamzaHasan/longhorn.git', 0.5, 1.5], ['cd longhorn && pnpm install', 2.3, 0.9], ['pnpm create:app ../my-api --runtime node', 3.6, 1.2],
    ['cd ../my-api && pnpm install', 5.2, 0.9], ['pnpm dev', 6.5, 0.4], ['curl http://127.0.0.1:3000/health', 7.4, 1],
  ]
  const Y = (i) => WY + 100 + i * 52, adv = mono.getAdvanceWidth('x', S)
  const typed = rows.map(([s, t, secs], i) => {
    const w = s.length * adv + 4, x = X + 2 * adv
    f.track(`k${i}`, [[0, { x: 0, o: 0 }], [t, { o: 1 }], [t + secs, { x: w }, secs, 'linear'], [DUR - 0.3, { x: w, o: 0 }, 0.26, 'exit']])
    f.track(`u${i}`, [[0, { x: 0, o: 0 }], [t, { o: 1 }], [DUR - 0.3, { o: 0 }, 0.26, 'exit']])
    return `<g class="u${i}">${text(mono, '$', X, Y(i), S, C.iron)}${text(mono, s, x, Y(i), S, C.chalk)}</g><clipPath id="r${i}"><rect x="${x - 2}" y="${Y(i) - 28}" width="${w + 6}" height="40"/></clipPath><g clip-path="url(#r${i})"><g class="k${i}"><rect x="${x - 2}" y="${Y(i) - 28}" width="${w + 6}" height="40" fill="${C.panel}"/></g></g>`
  }).join('')
  f.track('reply', [[0, { o: 0, y: 8 }], [8.9, { o: 1, y: 0 }, 0.4, 'decel'], [DUR - 0.3, { o: 0 }, 0.26, 'exit']])
  f.write(`${ground(W, H)}<rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="14" fill="${C.panel}" stroke="${C.faint}"/><path d="M${WX} ${WY + 50}H${WX + WW}" stroke="${C.faint}"/>${text(body, 'Terminal', WX + 24, WY + 33, 21, C.muted)}
    ${typed}<g class="reply">${text(mono, '{"status":"ok","runtime":"node","ready":true}', X, Y(6), S, C.ok)}</g>`)
}
