# Independent command application distribution

Owner: `scripts/package-command-app.mjs` and `starters/command-app`. Connects the
[complete example](command-application.md), [persistent host](persistent-operator-host.md)
and [framework snapshots](project-generation.md).

```sh
pnpm package:command-app
tar -xzf .artifacts/longhorn-command-app.tgz -C /your/empty/workspace
cd /your/empty/workspace/longhorn-command-app
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

The archive contains editable PostgreSQL application/console source, the protected
receiver/receipt source, local launcher, deployment tools and setup guides. Its
exact transitive @longhornjs closure comes from the CLI's built snapshot; every
dependency resolves through file overrides inside the archive. There are no
workspace paths, workspace protocol dependencies, copied node_modules or secrets.
External dependencies still require a package registry on first installation.
The archive includes a [locked dependency graph](command-app-dependencies.md) and
records its hash; frozen installation uses that graph without rewriting it.

Follow the archive's docs/setup.md for separate database owner/runtime logins,
complete migrations, restricted grants, receiver capability/storage and the
runtime-only .operator.env. Built assets use the same API/account policy as the
workspace example. This is an additional complete application distribution;
the existing four generic CLI runtime starters remain available.

The creation helper stages a whole directory and refuses a nonempty or symlink
destination. Packaging emits a tar archive and SHA-256 sidecar under ignored .artifacts. The
native gate checks that checksum before extraction. It does not
install globally, publish a package, provision a user's database or deploy a host.
`pnpm test:command-app` relocates the actual archive, installs/typechecks/tests/
builds it independently and exercises real PostgreSQL, native passwords, browser
assets, receipt effects, recovery and process restart. See
[distribution verification](command-app-testing.md) and [deployment](command-app-deployment.md).

The archive and [CLI command-app profile](command-project.md) now share one
[checked snapshot recipe](command-project-snapshot.md) through createProject. CLI
creation can be used directly with an explicit directory/name; the archive adds
its existing resolved lock/hash and tar/checksum packaging.
