# Task cursor pages

GET /tasks returns {tasks,nextCursor}; follow nextCursor until null to enumerate
all tasks. limit defaults to 20 and accepts canonical decimal 1–100. after is a
positive canonical decimal int64 ID; completed accepts literal true/false.
Unknown/duplicate query parameters and malformed values return 400. IDs/cursors
remain decimal strings, including values above JavaScript's safe integer range.

The SQL repository binds inputs, orders by numeric tasks.id and fetches limit+1
rows, returning at most limit. A lookahead row yields the last returned ID as the
cursor. A deleted cursor row remains a valid numeric boundary. Pages are uncached
live observations; concurrent inserts/deletes/updates can change membership. Keep
the filter between pages. This is not snapshot pagination or an authorization token.

The primary key supports ID traversal; an appended (completed,id) index supports
filtered ranges. GET /summary uses whole-collection aggregates independently of
page filters. See [counts](task-counts.md), [upgrades](upgrades.md) and [testing](testing.md).
