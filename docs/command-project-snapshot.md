# Shared command template and source ownership

Owner: cli/scripts/snapshot.mjs, cli/src/command-template.ts and the
[trusted asset reader](application-template-assets.md). Connects
[profile](command-project.md), [distribution](command-app-distribution.md)
and [proof](command-project-testing.md).

The builder creates templates/command-app inside the packed CLI framework snapshot.
It copies actual PostgreSQL application and console source, excluding the native
.postgres.test.ts fixture cases that depend on repository tooling. Other source
tests stay editable. Four real receiver modules, starter tools/guides, the runtime
env example and unchanged LICENSE accompany them. No database/receiver data,
private environment, node_modules or workspace link is copied.

The receiver launcher comes from the working repository host. Four checked exact
path/import mappings replace workspace dependencies, built receiver entry and
retained storage path. Unexpected mapping drift fails the build. Standalone strict
compiler configurations replace monorepo inheritance for app, browser and receiver.
All other copied application sources retain their bytes.

Descriptor v1 records dependencies and regular UTF-8 asset hashes. The common reader
enforces its existing relative-path, required-file/dependency and hash checks,
128-file/2-MiB total/512-KiB individual bounds before staging. Critical runtime-role,
schema, receiver and setup assets are explicit requirements. Hashes detect damage
within a trusted local distribution; they are not artifact signatures. Custom
frameworkDirectory remains a trusted source of descriptors and compiled packages.

The generator selects the app's transitive framework graph plus the explicit
Workers/runtime receiver dependencies. Bun/Deno packages are absent. Relative file
overrides make every @longhornjs dependency local to .longhorn/framework. Generated
metadata records schemaVersion=1, runtime=node, framework=snapshot,
template=command-app and application=commands. The application distribution record
lists its framework packages; archive packaging additionally records a resolved
lock hash. Names and README heading reflect the chosen project name.

scripts/package-command-app.mjs now delegates creation to the same createProject
profile, then performs its existing lock-only resolution and archive/checksum steps.
It no longer maintains a parallel source-copy recipe. Whole-directory staging and
the final destination check preserve occupied/symlink targets and prevent partial
publication if validation/copy fails. Generated application source belongs to the
developer after creation; the original hashes do not forbid edits or upgrade it.

The template also requires [development tools](command-source-development.md):
shared build settings, one source owner, native close helper and their generated
guide. They use existing Node/esbuild dependencies and the same checked recipe.

The checked template also requires [preflight source and guide](operator-preflight.md).
Its native check entry is part of the common app build settings; configuration and
runtime schema helpers are shared with the live host, without new dependencies.
