# Shared application template assets

Owner: cli/src/asset-template.ts, profile wrappers and cli/scripts/snapshot.mjs.
Connects [Node SQLite](sqlite-starter.md), [Bun SQLite](bun-sqlite-starter.md), [D1](d1-starter.md) and
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

The Bun wrapper retains the public sqlite-tasks identity while selecting the
fixed bun-sqlite-tasks asset directory through assetName. It chooses Bun metadata,
native bun:test scripts and esbuild/Bun approvals. Descriptor version 1 and the
Node/D1 catalog entries remain compatible. Actual shared task source and Bun
host/storage wiring are copied with checked import/runner/mock-type adaptations;
the output excludes Node/Redis hosts and uses only the selected Bun closure.
See [Bun distribution and proof](bun-sqlite-starter-testing.md).

The Deno wrapper selects fixed deno-sqlite-tasks assets under the same public
SQLite identity. It requires native test/launcher tools, uses esbuild/Deno build
approvals and retains descriptor v1. Shared app/test source and Deno host/storage
use checked mappings; named permission files are runtime-owned outputs rather
than static descriptor assets. See [Deno snapshot](deno-sqlite-starter-snapshot.md),
[launcher](deno-sqlite-starter-permissions.md) and [proof](deno-sqlite-starter-testing.md).

Build snapshots copy application source from its working example, preserving bytes.
The Node profile excludes the separate redis-* host/config files. Its persistence
test is adapted from the proven repository gate at two checked import/entry paths;
source drift at those mappings fails the CLI build for review. Supporting tools/
guides and unchanged MIT license join the source in packed CLI assets.

Generated files become application-owned. Their original asset hashes are checked
at creation, not used to forbid edits. Snapshot updates require deliberate review.
See [D1 distribution](d1-starter-snapshot.md) and [native regression proof](sqlite-starter-testing.md).

The [command-app wrapper](command-project-snapshot.md) uses the same descriptor v1
and bounds. Its required roles/schema, receipt receiver and setup tools come from
the actual application; the archive now consumes this profile too. An application
distribution record is generated separately from descriptor-owned source assets.
