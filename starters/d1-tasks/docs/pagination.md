# Exact cursor pages

Task/activity queries use position > after and a qualified integer ORDER BY,
fetching limit plus one. CAST(position AS TEXT) preserves int64 cursors. Ordering
by that text alias would incorrectly place 10 before 9. after defaults to "0"
and accepts canonical decimal through "9223372036854775807"; limit defaults to
20 (1–50). nextCursor is the last returned position or null. These are live keyset
pages, without a frozen multi-request snapshot or authorization token.
See [database](database.md), [tasks](tasks.md) and [activity](activity.md).
