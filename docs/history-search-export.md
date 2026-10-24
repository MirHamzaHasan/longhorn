# Searched history export v2

Owner: console/history-export.ts and the Commands export control. Connects
[existing files](history-export-format.md), [search](history-id-search.md),
[v3 cursors](history-search-cursors.md) and [verification](history-search-testing.md).

An unsearched export retains its exact v1 header and scope/state selection.
A nonempty canonical q produces version=2 and selection={scope,state,q}, keeping
the same command-record and end-summary shapes. This explicit version prevents
a reader from mistaking a narrowed search for an unsearched complete traversal.
Consumers must recognize the version and selection before interpreting the file.

Every export page includes the applied q along with scope/state. Continuation
uses its search-bound v3 cursor. The collector copies/validates the prefix before
awaiting reads, so later changes cannot relabel the file. Blank q is unsearched;
malformed search fails before preparation. Changing selection or navigating still
discards the current attempt without a download.

All existing row/page/UTF-8/time limits, explicit continuation files, metadata-only
projection, failure discard and Blob cleanup remain unchanged. The filename does
not include q; the header records the entered prefix. Numbers, payloads, lease
tokens, credentials, receipts and audit stay excluded. Live traversal remains
distinct from a database snapshot or backup/import format.
