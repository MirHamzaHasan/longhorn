#!/usr/bin/env node
// Task board and path claims for agents working in parallel. See tasks/README.md.
// Claims live in the git common directory: every worktree sees them, none commits them.
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const git = (args, cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '')
const fail = (message) => { console.error(message); process.exit(1) }

function options(argv) {
  const positional = [], flags = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue }
    const name = argv[i].slice(2)
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) flags[name] = true
    else flags[name] = argv[++i]
  }
  return { positional, flags }
}

const root = git(['rev-parse', '--show-toplevel'])
const claimsDirectory = resolve(root, git(['rev-parse', '--git-common-dir']), 'longhorn-claims')
const worktrees = git(['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9))
const list = (value) => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : [])

export function parseTask(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!match) return undefined
  const task = { paths: [], shared: [], depends: [] }
  let key
  for (const line of match[1].split('\n')) {
    const item = /^\s+-\s+(.+)$/.exec(line)
    if (item && Array.isArray(task[key])) { task[key].push(item[1].trim()); continue }
    const field = /^(\w+):\s*(.*)$/.exec(line)
    if (!field) continue
    key = field[1]
    if (!Array.isArray(task[key])) task[key] = field[2].trim()
  }
  return task.id ? task : undefined
}

/** Reads tasks from every worktree, so a task created on another branch still counts. */
function readTasks() {
  const tasks = new Map()
  for (const worktree of [root, ...worktrees.filter((path) => path !== root)]) {
    const directory = join(worktree, 'tasks')
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory).filter((file) => /^task\d+.*\.md$/.test(file)).sort()) {
      const file = join(directory, name), task = parseTask(readFileSync(file, 'utf8'))
      if (task && !tasks.has(task.id)) tasks.set(task.id, { ...task, name, file })
    }
  }
  return tasks
}

function readClaims() {
  if (!existsSync(claimsDirectory)) return []
  return readdirSync(claimsDirectory).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(claimsDirectory, name), 'utf8')))
}

/** A path ending in / owns everything below it; anything else owns one exact file. */
export const overlaps = (a, b) => a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b))
const owns = (paths, file) => paths.some((path) => overlaps(path, file))

function requireTask(tasks, id) {
  const task = tasks.get(id)
  if (!task) fail(`Unknown task ${id}. Run: pnpm task list`)
  return task
}

function changedFiles(cwd, base) {
  const files = new Set()
  const status = git(['status', '--porcelain', '-z', '-uall'], cwd).split('\0').filter(Boolean)
  for (let i = 0; i < status.length; i++) {
    files.add(status[i].slice(3))
    if (/^[RC]/.test(status[i])) i++ // The -z format follows a rename with its old name.
  }
  if (base) for (const file of git(['diff', '--name-only', `${base}..HEAD`], cwd).split('\n').filter(Boolean)) files.add(file)
  return files
}

const commands = {
  list() {
    const tasks = readTasks(), claims = new Map(readClaims().map((claim) => [claim.id, claim]))
    if (tasks.size === 0) { console.log('No tasks yet. Create one with: pnpm task new <slug> --title "..." --paths a/,b'); return }
    for (const task of tasks.values()) {
      const claim = claims.get(task.id)
      console.log(`${task.id}  ${(claim ? 'active' : task.status).padEnd(8)} ${task.title}`)
      if (claim) console.log(`         ${claim.agent} on ${claim.branch} in ${claim.worktree}`)
      if (claim || task.status === 'backlog' || task.status === 'blocked') console.log(`         owns ${task.paths.join(', ') || 'nothing yet'}`)
      if (task.depends.length) console.log(`         after ${task.depends.join(', ')}`)
    }
  },

  new({ positional: [slug], flags }) {
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail('Usage: pnpm task new <slug> --title "..." --paths a/,b --shared docs/features.md')
    const used = [...readTasks().keys(), ...readClaims().map((claim) => claim.id)].map((id) => Number(id.slice(4)))
    const id = `task${String(Math.max(0, ...used) + 1).padStart(3, '0')}`
    const lines = (values) => values.map((value) => `  - ${value}`).join('\n')
    const text = readFileSync(join(root, 'tasks/TEMPLATE.md'), 'utf8').replace('{{ID}}', id).replace('{{TITLE}}', typeof flags.title === 'string' ? flags.title : slug)
      .replace('{{PATHS}}\n', lines(list(flags.paths)) ? `${lines(list(flags.paths))}\n` : '').replace('{{SHARED}}\n', lines(list(flags.shared)) ? `${lines(list(flags.shared))}\n` : '')
    const file = join(root, 'tasks', `${id}-${slug}.md`)
    writeFileSync(file, text, { flag: 'wx' })
    console.log(`Created ${relative(process.cwd(), file)}. Fill it in, then: pnpm task claim ${id} --agent <name>`)
  },

  claim({ positional: [id], flags }) {
    if (!id || typeof flags.agent !== 'string') fail('Usage: pnpm task claim <id> --agent <name> [--here] [--force]')
    const task = requireTask(readTasks(), id), claims = readClaims(), slug = task.name.replace(/^task\d+-?/, '').replace(/\.md$/, '') || id
    if (claims.some((claim) => claim.id === id)) fail(`${id} is already claimed. Run: pnpm task list`)
    if (task.status === 'done') fail(`${id} is done.`)
    if (!task.paths.length) fail(`${id} lists no paths. Add the paths it owns first.`)
    if (!flags.force) {
      const clashes = claims.flatMap((claim) => claim.paths.filter((path) => task.paths.some((mine) => overlaps(mine, path))).map((path) => `  ${path} is owned by ${claim.id} (${claim.agent})`))
      if (clashes.length) fail(`Cannot claim ${id}; its paths overlap active work:\n${clashes.join('\n')}\nNarrow paths:, split the task, or wait.`)
    }
    const branch = typeof flags.branch === 'string' ? flags.branch : `${flags.agent}/${slug}`
    let worktree = root, dirty = []
    if (flags.here) {
      const holder = claims.find((claim) => claim.worktree === root)
      if (holder && !flags.force) fail(`This worktree already belongs to ${holder.id}. One worktree, one task.`)
      dirty = [...changedFiles(root)]
    } else {
      worktree = join(dirname(worktrees[0]), `${worktrees[0].split('/').pop()}-worktrees`, slug)
      if (existsSync(worktree)) fail(`${worktree} already exists.`)
    }
    mkdirSync(claimsDirectory, { recursive: true })
    const base = git(['rev-parse', 'HEAD'])
    // Exclusive create: of two simultaneous claims, exactly one wins.
    let handle
    try { handle = openSync(join(claimsDirectory, `${id}.json`), 'wx') } catch { fail(`${id} was claimed a moment ago. Run: pnpm task list`) }
    try {
      if (!flags.here) {
        mkdirSync(dirname(worktree), { recursive: true })
        git(['worktree', 'add', '-b', branch, worktree, base])
        const copy = join(worktree, 'tasks', task.name)
        if (!existsSync(copy)) { mkdirSync(dirname(copy), { recursive: true }); writeFileSync(copy, readFileSync(task.file)) }
      }
      const current = flags.here ? git(['branch', '--show-current']) : branch
      writeSync(handle, `${JSON.stringify({ id, agent: flags.agent, branch: current, worktree: realpathSync(worktree), base, paths: task.paths, shared: task.shared, dirtyAtClaim: dirty, claimedAt: new Date().toISOString() }, null, 2)}\n`)
    } catch (error) {
      closeSync(handle)
      rmSync(join(claimsDirectory, `${id}.json`), { force: true })
      fail(`Could not create the worktree: ${error.stderr ?? error.message}`)
    }
    closeSync(handle)
    console.log(`Claimed ${id} for ${flags.agent}.\n  Worktree: ${worktree}\n  Task:     tasks/${task.name}`)
    if (!flags.here) console.log(`Next:\n  cd "${worktree}"\n  pnpm install --frozen-lockfile`)
  },

  check({ positional: [id] }) {
    const claims = readClaims(), here = realpathSync(root), claim = id ? claims.find((item) => item.id === id) : claims.find((item) => item.worktree === here)
    if (!claim) fail('No claim for this worktree. Run: pnpm task list, then pnpm task claim <id> --agent <name>')
    const others = claims.filter((other) => other.id !== claim.id), ignored = new Set(claim.dirtyAtClaim)
    const outside = [], clashing = [], shared = []
    for (const file of [...changedFiles(claim.worktree, claim.base)].sort()) {
      if (ignored.has(file) || file.startsWith(`tasks/${claim.id}`)) continue
      const holder = others.find((other) => owns(other.paths, file))
      if (holder) clashing.push(`  ${file} (owned by ${holder.id}, ${holder.agent})`)
      else if (claim.shared.includes(file)) shared.push(`  ${file}`)
      else if (!owns(claim.paths, file)) outside.push(`  ${file}`)
    }
    if (shared.length) console.log(`Shared files changed. Keep these edits append-only:\n${shared.join('\n')}`)
    if (ignored.size) console.log(`Ignoring ${ignored.size} files that were already uncommitted at claim time.`)
    if (clashing.length) console.error(`Files owned by another active task:\n${clashing.join('\n')}`)
    if (outside.length) console.error(`Files outside ${claim.id}. Revert them, or add them to the task:\n${outside.join('\n')}`)
    if (clashing.length || outside.length) process.exit(1)
    console.log(`${claim.id}: every change is inside the claim.`)
  },

  release({ positional: [id], flags }) {
    if (!id) fail('Usage: pnpm task release <id> [--status backlog|blocked|review|done]')
    const task = requireTask(readTasks(), id), claim = readClaims().find((item) => item.id === id)
    if (!claim) fail(`${id} is not claimed.`)
    if (flags.status !== undefined) {
      if (!['backlog', 'blocked', 'review', 'done'].includes(flags.status)) fail('Status must be backlog, blocked, review or done.')
      const file = existsSync(join(claim.worktree, 'tasks', task.name)) ? join(claim.worktree, 'tasks', task.name) : task.file
      writeFileSync(file, readFileSync(file, 'utf8').replace(/^status: .*$/m, `status: ${flags.status}`))
    }
    rmSync(join(claimsDirectory, `${id}.json`))
    console.log(`Released ${id}.${claim.worktree === realpathSync(worktrees[0]) ? '' : ` Its worktree stays at ${claim.worktree} until the branch is merged.`}`)
  },
}

const [command, ...rest] = process.argv.slice(2)
if (!commands[command]) fail('Usage: pnpm task <list|new|claim|check|release>. See tasks/README.md.')
commands[command](options(rest))
