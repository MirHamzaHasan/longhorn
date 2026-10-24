# Shared application template assets

Owner: cli/src/asset-template.ts, profile wrappers and cli/scripts/snapshot.mjs.
Connects [SQLite](sqlite-starter.md), [D1](d1-starter.md) and
[framework snapshots](project-generation.md) through the same trusted asset reader.

The reader retains descriptor schemaVersion 1. Named profile wrappers supply
runtime, required source/support files, direct dependency names, fixed scripts
and native build approvals. Manifest data supplies external versions, dependency
sets and explicit file hashes. The catalog is a fixed CLI feature, without dynamic
downloaded templates or untrusted plugin execution.

Before staging, the reader validates metadata records, required entries, relative
non-escaping paths, SHA-256 content hashes, UTF-8 and bounds: 128 files, 2 MiB total,
512 KiB per file. Output package/workspace manifests stay generator-owned. Hashes
detect corruption, not authenticity. Custom frameworkDirectory inputs are trusted
local distributions and must include the chosen template's descriptor/assets.

The D1 wrapper keeps its existing file requirements, scripts, Workers metadata and
esbuild/workerd approvals. The Node wrapper selects SQLite source, tsx watch and
its native persistence test. Shared generation still copies only each selected
framework closure and rewrites internal packages to relative file overrides.

Build snapshots copy application source from its working example, preserving bytes.
The Node profile excludes the separate redis-* host/config files. Its persistence
test is adapted from the proven repository gate at two checked import/entry paths;
source drift at those mappings fails the CLI build for review. Supporting tools/
guides and unchanged MIT license join the source in packed CLI assets.

Generated files become application-owned. Their original asset hashes are checked
at creation, not used to forbid edits. Snapshot updates require deliberate review.
See [D1 distribution](d1-starter-snapshot.md) and [native regression proof](sqlite-starter-testing.md).
