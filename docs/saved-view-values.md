# Canonical saved-view values

Owner: src/history-view-values.ts and history-search-values.ts in the PostgreSQL
example. These pure Web modules are used by both the account API and console.
Connects [HTTP](saved-view-http.md), [schema](saved-view-migrations.md) and
[canonical navigation](history-view-links.md).

Names accept at most 320 raw UTF-16 units, trim outer whitespace and normalize to
NFC, then require 1..80 Unicode code points and at least one visible letter,
number, punctuation or symbol. Controls, line separators, lone surrogates and
format-only names are rejected. Case is preserved. SQL uniqueness uses the
normalized name under C collation, so Café and its decomposed spelling collide,
while TRIAGE and triage remain distinct. Browser rendering uses textContent.

Selection has exactly scope (mine/all), state (all/pending/running/succeeded/failed/
unavailable), and optional q. ID search keeps the existing trimmed/lowercase
canonical UUID-prefix rule: 4..36 characters, correct hyphen positions, bounded
raw input and no wildcard/payload search. Blank q is omitted. Unknown owner,
actor, queue, cursor, limit or return-target fields are rejected. Values are copied
before async work; a saved record cannot supply an arbitrary destination URL.

The existing console history-search entry now re-exports the moved pure helper,
preserving its public behavior and error class. Console typechecking includes
these shared source modules; esbuild imports no server SQL/auth code. Stored fields
are validated again on read. [Native/browser proof](saved-view-testing.md) checks
canonical values, Unicode bounds, plain-text rendering and bundle separation.
