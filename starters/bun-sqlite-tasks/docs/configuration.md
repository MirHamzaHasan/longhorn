# Configuration

The host validates Bun.env using src/config.ts before opening storage or listening.
APP_NAME defaults to LongHorn, HOST to 127.0.0.1, PORT to 3000, LOG_LEVEL to info,
DATABASE_PATH to ./data/longhorn.sqlite and CACHE_TTL_MS to 5000. PORT=0 asks for an
available port. :memory: selects temporary storage. Invalid settings fail startup.

Bun owns environment-file loading from the host working directory, including its
NODE_ENV-dependent behavior. Process values win. CLI scripts and the development
watcher launch from this project. When launching the Bun executable directly from
another directory, supply settings explicitly or follow Bun's environment-file
options. This host adds no custom dotenv reader or environment mutation.

Relative DATABASE_PATH always resolves from the project, for both src/index.ts
and dist/index.js. It is independent of the launch working directory. See
[runtime](runtime.md), [SQLite](sqlite.md) and [testing](testing.md).
