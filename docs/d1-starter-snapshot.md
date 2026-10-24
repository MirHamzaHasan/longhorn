# D1 template assets and dependency closure

Owner: cli/scripts/snapshot.mjs and cli/src/d1-template.ts. Connects
[template selection](d1-starter.md), [framework snapshots](project-generation.md)
and the existing [D1 application](d1-tasks.md).

The wrapper now delegates common metadata/file/hash validation to
[the shared asset reader](application-template-assets.md). Descriptor version 1,
D1 required files, runtime/scripts and output behavior stay compatible.

The CLI build copies current examples/d1-worker/src files into its built template
assets. Domain code is not maintained as a second string template. Application
dependencies/dev tooling derive from that example, with explicit runtime and local
Miniflare/test tooling. Supporting scripts and application guides come from
starters/d1-tasks. The MIT license is copied with the app.

The proven repository host is adapted only at checked import/file/default-port
locations: framework package imports, generated dist files, project data/d1 and
port 3000. Each expected source replacement must occur exactly once; changes to
the source host fail packaging until mappings are reviewed. No schema/HTTP route
is added during this adaptation.

The bundled template.json records a schema version, dependency sets and SHA-256
hashes of explicit text assets. Generation validates hashes, UTF-8, required files,
relative paths and 128-file/2 MiB aggregate/512 KiB per-file bounds before staging.
Malformed or accidentally corrupted assets reject without publishing a partial
project. Hashes detect corruption; they are not signatures or an untrusted-plugin
sandbox. Custom frameworkDirectory distributions are trusted local inputs and
must include templates/d1-tasks assets with the same format.

The generator walks direct/transitive framework dependencies, normalizes internal
versions and writes local file overrides. User source and selected built package
files are independent copies. Package manifests/scripts contain no source-checkout
path. Names expand only the README placeholder; generated framework links remain
relative. The complete distribution is included in the CLI archive, so installed
package binaries have the same template without reading the repository.

Generated files become application-owned. Asset hashes are checked during creation,
not used to prohibit later edits. Updates require deliberate review/regeneration;
there is no automatic overwrite, package publication or schema rollout. See
[native packed-binary proof](d1-starter-testing.md).
