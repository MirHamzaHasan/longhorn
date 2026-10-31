# scripts and CI

`verify-*.mjs` are native gates: real engines, processes, sockets and browsers.
`demo-*` and `serve-*` run local hosts. `fixtures/` holds their helpers. CI is
`.github/workflows/verify.yml`; see [docs/release-verification.md](../docs/release-verification.md).

- Gates import compiled output, so run `pnpm build` first and finish it before they
  start. Cleaning `dist/` during a gate invalidates the result.
- Gates may write proofs and captures to `.artifacts/`. It is ignored and local to a
  worktree, so another checkout may not have your evidence.
- Prefer port 0 in new gates. Older gates and dev hosts use fixed ports, so run those
  one at a time on this machine.
- Do not weaken a failing gate to pass it. Report the failure with its output.
- A new gate needs a `package.json` script, and usually a line in `verify.yml`.
- CI has read-only permissions and no deployment or secrets, and it runs on pull requests
  from forks. Keep it that way, except for the separate Pages workflow.
- `scripts/task.mjs` is the task tool. Test it with `pnpm test:tasks`.
