# Configuration

src/index.ts loads project .env then .env.local through @longhornjs/node/config;
defined process values win. loadConfig validates src/config.ts before opening the
database/listener. APP_NAME defaults to LongHorn, HOST to 127.0.0.1, PORT to 3000
(0 selects an available port), LOG_LEVEL to info and CACHE_TTL_MS to 5000 (0–3600000).

DATABASE_PATH defaults to ./data/longhorn.sqlite and resolves from the project
for both src/index.ts and dist/index.js, independently of launch cwd. Parent data
directories are created by the provider. :memory: explicitly disables persistence.
Keep real .env files out of source control. See [SQLite](sqlite.md), [cache](cache.md)
and [runtime](runtime.md).
