# examples

Runnable applications that prove the modules work together. Each has its own guide;
search [docs/features.md](../docs/features.md).

`examples/postgres` is the main integration. Start at `src/app.ts`, then `accounts.ts`,
`operations.ts` and `operator-host.ts`. `console/` is its browser app.

- Migrations append after the complete existing profile. Never rewrite a deployed
  statement. Runtime roles get only the grants listed in `docs/runtime-role-grants.md`.
- The browser never supplies an owner, actor or role. The server derives them.
- Console: no external fonts or scripts, no invented data, no animation that carries
  meaning, and private rows stay out of browser storage. Rules are in
  `docs/console-design.md` and `docs/console-security.md`.
- Check console screens with real captures in both themes at desktop and phone widths.
- Source shipped to generated apps is listed in `cli/src/command-template.ts`. A new
  console or app file usually has to be added there, and to `cli/src/generator.test.ts`.
- Two agents editing `console/app.ts` or `console/app.css` will collide. Claim them
  exactly, and put new behaviour in a new file as `console/history-live.ts` does.
- Dev hosts bind fixed ports from 3000 to 3017. Set `PORT` when another worktree is
  running one.
- Gates: `pnpm test:console` for the browser, `pnpm test:operator-accounts` and
  `pnpm test:persistent-operations` for the host.
