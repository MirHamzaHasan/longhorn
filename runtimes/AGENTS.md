# runtimes

Native listeners, connections, crypto and platform events for Node, Bun, Deno and
Workers. Scope per runtime is in [docs/supported-runtimes.md](../docs/supported-runtimes.md).

- Each adapter uses its platform's real API. Do not alias one runtime through another.
- Public declarations use shared runtime types, so platform types do not leak.
- Signals, permissions and process policy belong to hosts, not to these adapters.
- Workers has no long-running server process and no guaranteed eviction callback.
  Do not add Node-style lifetime assumptions.
- A claim about a runtime needs a run on that runtime. Run `pnpm test:runtimes` for
  adapters, and the matching gate for storage, such as `pnpm test:bun-sqlite`.
- Do not change the pinned Bun, Deno or Miniflare versions as a side effect.
- Update the row in `docs/supported-runtimes.md` when verified scope changes.
