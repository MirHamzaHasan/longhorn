# Safe live delivery status in command history

Owner: PostgresCommandHistory's explicit SQL projection. Connects
[history API](account-command-history.md), [Outbox metadata](outbox-inspection.md),
[retention](outbox-retention.md) and [persistent hosting](persistent-operator-host.md).

Each history page performs one bounded query. It selects command identity/time
and left-joins longhorn_queue.jobs using both the recorded delivery ID and the
fixed outbox.command.numbers.v1 queue. The projection includes only state,
attempts, maximum attempts, availability/update times and classified failure.
It does not fetch command numbers, outgoing payloads, lease tokens or arbitrary
exception text. This avoids a separate job lookup for every displayed row.

deliveryId is the retained command-to-delivery association. delivery is current
metadata when that matching outgoing row exists. After pruning, the ID remains
and delivery becomes null. A legacy command whose association could not be
recovered has null deliveryId and null delivery. These mean unavailable/unknown,
not pending or succeeded. The account detail/receipt routes remain separate.

Actual dispatch/retry changes are visible on subsequent history reads. The
idempotency ledger's original response is deliberately immutable; replaying a
create request does not rewrite it with newer delivery state. Consumer receipt
existence is also a separate fact: remote commit can precede acknowledgement,
so a running/retrying publisher can already have a deduplicated consumer effect.

The query needs only the listed command columns and outgoing metadata columns.
The native gate creates a dedicated projection role lacking numbers, payload and
lease-token SELECT, then executes the real repository successfully. The normal
runtime retains its existing broader grants for other authorized operations;
this feature introduces no general queue or command mutation privilege.

Pruning does not cascade into command history, and unrelated queue IDs cannot
attach metadata. There is no payload or receipt polling during the SQL query.
The application/request lifecycle owns the borrowed connection and reader;
history installs no timer, cache or background process.
