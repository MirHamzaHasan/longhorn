// Builds the README's motion pieces: film.svg, hosts.svg and their -still.svg twins.
// See docs/website.md. Needs opentype.js and the @fontsource fonts in a folder of your choice:
//   npm install --prefix <folder> opentype.js @fontsource/league-gothic @fontsource/atkinson-hyperlegible @fontsource/ibm-plex-mono
//   node docs/assets/build-readme-motion.mjs <folder>
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const vendor = process.argv[2]
if (!vendor) throw new Error('Usage: node docs/assets/build-readme-motion.mjs <folder with the fonts>')
const out = dirname(fileURLToPath(import.meta.url))
const opentype = createRequire(join(vendor, 'package.json'))('opentype.js')
const font = (name) => opentype.loadSync(join(vendor, 'node_modules/@fontsource', name))
const display = font('league-gothic/files/league-gothic-latin-400-normal.woff')
const body = font('atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff')
const mono = font('ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff')

const C = { cyan: '#0f3a5e', deep: '#0a2b48', wire: '#7fb0d6', faint: '#2c5d85', chalk: '#f3f8fc', muted: '#c3d8e9', iron: '#ffc14d', flare: '#ffa390', paper: '#fbf7ea', ink: '#1b2b38' }
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
const text = (f, s, x, y, size, fill) => (f === mono ? monoText(s, x, y, size, fill) : `<path fill="${fill}" d="${f.getPath(s, x, y, size).toPathData(1)}"/>`)
const width = (f, s, size) => f.getAdvanceWidth(s, size)

// One timeline per object, so no two animations fight over an element. A frame holds its pose
// until the next frame's start, then moves there over `in` seconds on `ease`.
function film(name, W, H, title, DUR, REST) {
  const tracks = []
  const pose = (p) => `transform:translate(${p.x ?? 0}px,${p.y ?? 0}px) scale(${p.s ?? 1});opacity:${p.o ?? 1}${p.d === undefined ? '' : `;stroke-dashoffset:${p.d}`}`
  return {
    /** keys: [time the move ends, pose, seconds it takes, curve]. The first key is the start pose. */
    track(id, keys) { tracks.push({ id, keys }); return id },
    write(content) {
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
      const live = `${still}${moving.map((m) => `.${m.id}{animation:${m.id} ${DUR}s linear infinite}@keyframes ${m.id}{${m.css}}`).join('')}`
      const defs = `<defs>${[...glyphs.values()].map((g) => `<path id="${g.id}" d="${g.d}"/>`).join('')}</defs>`
      glyphs.clear()
      const doc = (style) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title}"><title>${title}</title><style>${style}</style>${defs}${content}</svg>\n`
      writeFileSync(join(out, `${name}.svg`), doc(live))
      writeFileSync(join(out, `${name}-still.svg`), doc(still))
    },
  }
}

const ground = (W, H) => `<defs><pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="${C.wire}" stroke-opacity=".08"/></pattern></defs><rect width="${W}" height="${H}" fill="${C.cyan}"/><rect width="${W}" height="${H}" fill="url(#g)"/>`

/* One take: a command, a crash, an outage and a receipt. The world stays put and the camera moves. */
{
  const W = 1280, H = 640, LINE = 240, DUR = 30, REST = 28
  const X = { client: 160, tx: 760, disp: 1360, recv: 1960 }
  const f = film('film', W, H, 'One continuous animation. A command for the numbers 4, 8 and 15 is saved with its message in one transaction. The process is killed, and both survive. After a restart, two delivery attempts fail while the receiver is down. The receiver comes back, the third attempt lands, and one receipt prints: count 3, sum 27, minimum 4, maximum 15. Write the backend once. Keep the work when the process dies.', DUR, REST)
  const cam = (cx, z = 1) => ({ x: +(640 - cx * z).toFixed(1), y: +(LINE - LINE * z - (1 - z) * 70).toFixed(1), s: z })

  f.track('all', [[0, { o: 1 }], [29.6, { o: 0 }, 0.28, 'exit']])
  f.track('cam', [[0, cam(560)], [3.9, cam(760, 0.85), 1, 'emph'], [7.3, cam(1060), 0.9, 'emph'], [11.9, cam(1660), 1.1, 'emph'], [22.9, cam(1590), 1.3, 'emph']])

  // The hero. Its pose is in world space, so it travels with the world.
  const chip = (cls) => `<g class="${cls}"><rect x="-82" y="-27" width="164" height="54" rx="9" fill="${C.iron}"/>${text(mono, '4, 8, 15', -width(mono, '4, 8, 15', 30) / 2, 10, 30, C.ink)}</g>`
  const SLOT_C = { x: X.tx, y: LINE - 30 }, SLOT_M = { x: X.tx, y: LINE + 36 }
  const FAIL = X.disp + 600 * 0.74
  const PT = LINE + 92, PW = 340, PX = X.recv - PW / 2, ROW = 26
  const LAND = { x: PX + PW - 22 - width(mono, '4, 8, 15', ROW) / 2, y: PT + 48 - 10 * (ROW / 30), s: ROW / 30 }
  f.track('cmd', [[0, { ...{ x: X.client, y: LINE }, o: 0, s: 0.9 }], [0.95, { o: 1, s: 1 }, 0.52, 'decel'], [3.95, SLOT_C, 0.9, 'inout']])
  f.track('msg', [[0, { ...SLOT_C, o: 0 }], [3.96, { o: 1 }], [4.95, SLOT_M, 0.7, 'inout'],
    [11.9, { x: X.disp, y: LINE }, 0.9, 'inout'],
    [13.0, { x: FAIL }, 0.7, 'inout'], [13.65, { x: X.disp }, 0.5, 'inout'],
    [15.8, { x: FAIL }, 0.7, 'inout'], [16.45, { x: X.disp }, 0.5, 'inout'],
    [19.2, { x: X.recv, y: LINE }, 0.9, 'inout'], [20.4, LAND, 0.72, 'inout'], [20.62, { o: 0 }, 0.2, 'exit']])

  // Stations
  const node = (x, label) => `<circle cx="${x}" cy="${LINE}" r="15" fill="${C.chalk}"/>${text(display, label, x - width(display, label, 46) / 2, LINE + 70, 46, C.chalk)}`
  const vault = `<rect x="${X.tx - 128}" y="${LINE - 84}" width="256" height="176" rx="14" fill="${C.deep}" stroke="${C.wire}" stroke-width="2.5"/>
    <rect class="commit" x="${X.tx - 128}" y="${LINE - 84}" width="256" height="176" rx="14" fill="none" stroke="${C.iron}" stroke-width="4"/>
    ${[LINE - 30, LINE + 36].map((y) => `<rect x="${X.tx - 90}" y="${y - 29}" width="180" height="58" rx="11" fill="none" stroke="${C.faint}" stroke-width="2" stroke-dasharray="6 6"/>`).join('')}
    ${text(display, 'One transaction', X.tx - width(display, 'One transaction', 46) / 2, LINE + 146, 46, C.chalk)}`
  f.track('commit', [[0, { o: 0 }], [4.95, { o: 1 }, 0.3, 'decel']])

  // The outage: broken wire and a flare receiver, crossed over to the working pair.
  f.track('down', [[0, { o: 1 }], [18.1, { o: 0 }, 0.42, 'decel']])
  f.track('downlabel', [[0, { o: 0 }], [11.6, { o: 1 }, 0.3, 'decel'], [17.98, { o: 0 }, 0.3, 'exit']])
  f.track('tick1', [[0, { o: 0 }], [13.02, { o: 1 }, 0.1, 'decel'], [13.5, { o: 0 }, 0.3, 'exit']])
  f.track('tick2', [[0, { o: 0 }], [15.82, { o: 1 }, 0.1, 'decel'], [16.3, { o: 0 }, 0.3, 'exit']])
  const tick = (cls) => `<g class="${cls}"><path d="M${FAIL + 96} ${LINE - 18}l28 36M${FAIL + 124} ${LINE - 18}l-28 36" stroke="${C.flare}" stroke-width="5" stroke-linecap="round"/></g>`

  // The receipt prints out of the receiver, and the chip's numbers become its first line.
  const rows = [['Numbers', '4, 8, 15'], ['Count', '3'], ['Sum', '27'], ['Minimum', '4'], ['Maximum', '15']]
  const PH = 244
  f.track('paper', [[0, { y: -PH - 24 }], [20.05, { y: 0 }, 0.75, 'emph']])
  f.track('r0', [[0, { o: 0 }], [20.41, { o: 1 }]])
  f.track('r0a', [[0, { o: 0, y: 10 }], [20.8, { o: 1, y: 0 }, 0.42, 'decel']])
  rows.slice(1).forEach((_, i) => f.track(`r${i + 1}`, [[0, { o: 0, y: 12 }], [21.06 + i * 0.07, { o: 1, y: 0 }, 0.42, 'decel']]))
  const zig = Array.from({ length: PW / 15 }, () => 'l-7.5 9l-7.5 -9').join('')
  const paper = `<clipPath id="well"><rect x="${PX - 8}" y="${PT}" width="${PW + 16}" height="${PH + 20}"/></clipPath><g clip-path="url(#well)"><g class="paper"><path fill="${C.paper}" d="M${PX} ${PT}h${PW}v${PH}${zig}z"/></g>${rows.map(([a, b], i) => { const label = text(mono, a, PX + 22, PT + 48 + i * 42, ROW, C.ink), value = text(mono, b, PX + PW - 22 - width(mono, b, ROW), PT + 48 + i * 42, ROW, C.ink); return i ? `<g class="r${i}">${label}${value}</g>` : `<g class="r0a">${label}</g><g class="r0">${value}</g>` }).join('')}</g><rect x="${PX - 18}" y="${PT - 8}" width="${PW + 36}" height="12" rx="6" fill="${C.deep}" stroke="${C.faint}"/>`

  // The kill: only what was committed stays lit.
  f.track('dark', [[0, { o: 0 }], [7.75, { o: 0.78 }, 0.14, 'exit'], [10.3, { o: 0 }, 0.5, 'decel']])
  f.track('kill', [[0, { o: 0, s: 1.12, x: 640, y: 94 }], [7.8, { o: 1, s: 1 }, 0.16, 'exit'], [10, { o: 0 }, 0.26, 'exit']])

  // Words change in one slot: the old ones lift out, the new ones rise in.
  const say = (id, lines, start, end, tone = C.chalk, size = 74) => {
    const keys = [[0, { o: 0, y: 24 }], [start + 0.4, { o: 1, y: 0 }, 0.52, 'decel']]
    if (end) keys.push([end, { o: 0, y: -16 }, 0.24, 'exit'])
    f.track(id, keys)
    const last = 592
    return `<g class="${id}">${lines.map((s, i) => text(display, s, 64, last - (lines.length - 1 - i) * (size + 6), size, i === lines.length - 1 && lines.length > 1 ? C.iron : tone)).join('')}</g>`
  }
  const words = [
    say('w1', ['You submit a command.'], 0.5, 3.4),
    say('w2', ['Saved with its message, in one transaction.'], 3.4, 7.3),
    say('w3', ['The process dies.'], 7.5, 9.75, C.flare),
    say('w4', ['It restarts. Both are still there.'], 9.8, 12.05),
    say('w5', ['Attempt 1 fails. Still saved.'], 12.1, 14.8, C.flare),
    say('w6', ['Attempt 2 fails. Still saved.'], 14.85, 17.7, C.flare),
    say('w7', ["Receiver's back. Attempt 3 lands."], 17.75, 20.3),
    say('w8', ['Two failures. One receipt.'], 20.3, 22.3, C.iron),
    say('w9', ['Write the backend once.', 'Keep the work when the process dies.'], 22.35),
  ]

  // The name stays in one place for the whole take.
  const horns = ['M46 27C33 29 19 27 11 19 7 15 4 9 3 3', 'M74 27C87 29 101 27 109 19 113 15 116 9 117 3', 'M46 27Q60 20 74 27L68 54Q60 62 52 54Z']
  f.track('horn', [[0, { d: 1 }], [1.1, { d: 0 }, 1, 'inout']])
  const mark = `<g transform="translate(58 38) scale(.62)">${horns.map((d) => `<path class="horn" pathLength="1" d="${d}" fill="none" stroke="${C.iron}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1"/>`).join('')}</g>${text(display, 'LongHorn', 146, 76, 50, C.chalk)}`

  f.write(`${ground(W, H)}<g class="all">
    <g class="cam">
      <path d="M${X.client} ${LINE}H${X.disp}" stroke="${C.wire}" stroke-width="3"/><path d="M${X.disp} ${LINE}H${X.recv}" stroke="${C.wire}" stroke-width="3"/>
      <g class="down"><path d="M${X.disp + 2} ${LINE}H${X.recv}" stroke="${C.cyan}" stroke-width="7"/><path d="M${X.disp + 16} ${LINE}H${X.recv}" stroke="${C.flare}" stroke-width="3" stroke-dasharray="11 11"/></g>
      ${node(X.client, 'Client')}${vault}${node(X.disp, 'Dispatcher')}${paper}${node(X.recv, 'Receiver')}
      <g class="down"><circle cx="${X.recv}" cy="${LINE}" r="16" fill="${C.flare}"/></g>
      <g class="downlabel">${text(body, 'Down', X.recv + 34, LINE + 10, 28, C.flare)}</g>
      ${tick('tick1')}${tick('tick2')}
    </g>
    <rect class="dark" width="${W}" height="${H}" fill="#061d32"/>
    <g class="cam">${chip('cmd')}${chip('msg')}</g>
    <g class="kill">${text(mono, 'SIGKILL', -width(mono, 'SIGKILL', 40) / 2, 14, 40, C.flare)}</g>
    ${mark}${words.join('')}
  </g>`)
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
    ${text(display, 'Change the host. Keep the app.', 64, 68, 62, C.chalk)}
    <rect x="${LX}" y="${panelY}" width="${W - 128}" height="${rowH * 5 + 24}" rx="12" fill="${C.deep}" stroke="${C.faint}"/>
    ${code("import { Longhorn } from '@longhorn/core'", y(0), C.muted)}
    ${code('const app = new Longhorn()', y(2), C.muted)}
    ${code("app.http.get('/health', health)", y(3), C.muted)}
    <rect x="${LX}" y="350" width="${W - 128}" height="58" rx="12" fill="#061d32" stroke="${C.faint}"/>
    ${code('GET /health', 388, C.muted)}
    ${lines}
    ${hosts.map((h, i) => text(display, h.name, slots[i], 476, 60, C.chalk)).join('')}
    <path d="M64 506H1216" stroke="${C.wire}" stroke-width="2.5"/>
    <g class="rail"><rect y="-3" x="0" width="${288 - 40}" height="9" rx="4.5" fill="${C.iron}" transform="translate(0 506)"/></g>`)
}
