# Creation and template ownership

Both `longhorn create DIRECTORY --runtime node --template command-app` and
`create-longhorn DIRECTORY --runtime node --template command-app` create this
application from the same checked template as the standalone archive. --name
sets the package name; --install runs pnpm only after complete creation. Without
--install, creation needs no registry, database, receiver or credentials.

The profile selects Node for PostgreSQL/native passwords and includes the Workers
framework package for the separate local receipt receiver. Bun/Deno/Workers are
rejected as the application runtime. This does not remove their other CLI profiles.
The private manifest records template=command-app and application=commands.

Editable app/console/receiver source, existing migrations, tests, deployment and
backup tools, the runtime env example and these guides belong to this project.
.longhorn/framework holds the selected compiled dependency closure. Template
hashes detect damaged trusted local assets before staging; they are not signatures.
The generator publishes one complete directory and refuses occupied/symlink targets.

Build first, then follow [setup](setup.md) for explicit owner/runtime roles and
receiver/runtime configuration. Creation never provisions a database or starts
hosts. First CLI installation creates a lock; packaged archives already carry
one. Preserve [dependency policy](dependencies.md) for later deployments.

`longhorn build`, `typecheck` and `test` run the project scripts. `longhorn start`
starts the unchanged fixed Node host directly and forwards shutdown once to that
resource owner. Custom start scripts or pre/post hooks use normal pnpm delegation.
`pnpm dev` builds once and watches built host output; after application/browser/
receiver source edits, rebuild and restart as described in [setup](setup.md).
Receiver startup remains a separate `pnpm receiver` command with its own settings.
