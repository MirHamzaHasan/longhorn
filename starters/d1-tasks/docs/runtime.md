# Workers runtime

src/index.ts exports the real Fetch adapter. Browser bundling rejects Node imports
from the Worker graph; Node APIs stay in build/development hosts. Miniflare
3.20250718.3 runs actual workerd with per-worker compatibility date 2025-07-18.
Only dist/index.js is the public app. The Wrangler example needs real owned IDs
and a trusted private schema process; nothing creates cloud resources or proves
managed replication/failover. See [schema](schema.md) and [development](development.md).
