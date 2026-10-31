// Runs the real task tool against real temporary git repositories and worktrees.
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const tool = fileURLToPath(new URL('./task.mjs', import.meta.url))
const template = fileURLToPath(new URL('../tasks/TEMPLATE.md', import.meta.url))
const created = []
after(() => { for (const directory of created) rmSync(directory, { recursive: true, force: true }) })

function repository() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'longhorn-task-'))), root = join(parent, 'repo')
  created.push(parent)
  mkdirSync(join(root, 'tasks'), { recursive: true })
  cpSync(template, join(root, 'tasks/TEMPLATE.md'))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
  writeFileSync(join(root, 'seed.txt'), 'seed\n'); git('add', '.'); git('commit', '-qm', 'seed')
  return { root, parent, run: (args, cwd = root) => spawnSync(process.execPath, [tool, ...args], { cwd, encoding: 'utf8' }) }
}

test('new allocates ids and writes the requested claim', () => {
  const { root, run } = repository()
  assert.equal(run(['new', 'first', '--title', 'First', '--paths', 'a/,b.txt', '--shared', 'docs/features.md']).status, 0)
  assert.equal(run(['new', 'second', '--paths', 'c/']).status, 0)
  const text = readFileSync(join(root, 'tasks/task001-first.md'), 'utf8')
  assert.match(text, /title: First/); assert.match(text, /paths:\n {2}- a\/\n {2}- b\.txt\n/); assert.match(text, /shared:\n {2}- docs\/features\.md\n/)
  assert.ok(existsSync(join(root, 'tasks/task002-second.md')))
  assert.equal(run(['new', 'Bad Slug']).status, 1)
})

test('claim creates a worktree and refuses overlapping or repeated claims', () => {
  const { parent, run } = repository()
  run(['new', 'one', '--paths', 'packages/queue/']); run(['new', 'two', '--paths', 'packages/queue/src/a.ts']); run(['new', 'three', '--paths', 'packages/cache/'])
  const claimed = run(['claim', 'task001', '--agent', 'codex'])
  assert.equal(claimed.status, 0, claimed.stderr)
  assert.ok(existsSync(join(parent, 'repo-worktrees/one/tasks/task001-one.md')))
  assert.equal(run(['claim', 'task001', '--agent', 'claude']).status, 1)
  const overlap = run(['claim', 'task002', '--agent', 'claude'])
  assert.equal(overlap.status, 1); assert.match(overlap.stderr, /owned by task001 \(codex\)/)
  assert.equal(run(['claim', 'task003', '--agent', 'claude']).status, 0)
  const board = run(['list']).stdout
  assert.match(board, /task001 {2}active/); assert.match(board, /task002 {2}backlog/); assert.match(board, /task003 {2}active/)
})

test('claims are visible from every worktree', () => {
  const { parent, run } = repository()
  run(['new', 'one', '--paths', 'a/']); run(['new', 'two', '--paths', 'a/b/'])
  run(['claim', 'task001', '--agent', 'codex'])
  const fromWorktree = run(['list'], join(parent, 'repo-worktrees/one'))
  assert.match(fromWorktree.stdout, /task001 {2}active/)
  assert.equal(run(['claim', 'task002', '--agent', 'claude'], join(parent, 'repo-worktrees/one')).status, 1)
})

test('check reports changes outside the claim and on another task\'s paths', () => {
  const { parent, run } = repository()
  run(['new', 'one', '--paths', 'a/', '--shared', 'shared.md']); run(['new', 'two', '--paths', 'b/'])
  run(['claim', 'task001', '--agent', 'codex']); run(['claim', 'task002', '--agent', 'claude'])
  const worktree = join(parent, 'repo-worktrees/one')
  mkdirSync(join(worktree, 'a')); writeFileSync(join(worktree, 'a/in.txt'), 'x'); writeFileSync(join(worktree, 'shared.md'), 'x')
  const clean = run(['check'], worktree)
  assert.equal(clean.status, 0, clean.stderr); assert.match(clean.stdout, /shared\.md/); assert.match(clean.stdout, /inside the claim/)
  writeFileSync(join(worktree, 'stray.txt'), 'x')
  mkdirSync(join(worktree, 'b')); writeFileSync(join(worktree, 'b/theirs.txt'), 'x')
  const dirty = run(['check'], worktree)
  assert.equal(dirty.status, 1); assert.match(dirty.stderr, /stray\.txt/); assert.match(dirty.stderr, /b\/theirs\.txt \(owned by task002, claude\)/)
})

test('check includes committed changes since the claim', () => {
  const { parent, run } = repository()
  run(['new', 'one', '--paths', 'a/']); run(['claim', 'task001', '--agent', 'codex'])
  const worktree = join(parent, 'repo-worktrees/one')
  writeFileSync(join(worktree, 'stray.txt'), 'x')
  execFileSync('git', ['add', 'stray.txt'], { cwd: worktree }); execFileSync('git', ['commit', '-qm', 'stray'], { cwd: worktree })
  const result = run(['check'], worktree)
  assert.equal(result.status, 1); assert.match(result.stderr, /stray\.txt/)
})

test('--here ignores work that was already uncommitted', () => {
  const { root, run } = repository()
  writeFileSync(join(root, 'earlier.txt'), 'someone else\n')
  run(['new', 'one', '--paths', 'a/'])
  assert.equal(run(['claim', 'task001', '--agent', 'claude', '--here']).status, 0)
  const before = run(['check'])
  assert.equal(before.status, 0, before.stderr); assert.match(before.stdout, /already uncommitted/)
  writeFileSync(join(root, 'later.txt'), 'x')
  const after = run(['check'])
  assert.equal(after.status, 1); assert.match(after.stderr, /later\.txt/); assert.doesNotMatch(after.stderr, /earlier\.txt/)
})

test('release frees the paths and records the status', () => {
  const { parent, run } = repository()
  run(['new', 'one', '--paths', 'a/']); run(['new', 'two', '--paths', 'a/']); run(['claim', 'task001', '--agent', 'codex'])
  assert.equal(run(['release', 'task001', '--status', 'nonsense']).status, 1)
  assert.equal(run(['release', 'task001', '--status', 'review']).status, 0)
  assert.match(readFileSync(join(parent, 'repo-worktrees/one/tasks/task001-one.md'), 'utf8'), /status: review/)
  assert.equal(run(['claim', 'task002', '--agent', 'claude']).status, 0)
})

test('claiming nothing and unknown tasks fail with direction', () => {
  const { run } = repository()
  run(['new', 'empty'])
  assert.match(run(['claim', 'task001', '--agent', 'codex']).stderr, /lists no paths/)
  assert.match(run(['claim', 'task099', '--agent', 'codex']).stderr, /Unknown task/)
  assert.match(run(['check']).stderr, /No claim/)
})
