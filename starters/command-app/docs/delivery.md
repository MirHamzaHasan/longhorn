# Durable outgoing delivery

Owner: src/operation-transport.ts, operations.ts and @longhornjs/outbox. The dispatcher
claims fenced leases, publishes a stable versioned message ID and tracks bounded
cumulative attempts. The explicit HTTP publisher accepts only HTTP 200 with a
matching accepted acknowledgement. Transport bytes, time and concurrency are
bounded. The receiver capability stays server-side.

A remote commit followed by response loss can repeat delivery. The consumer's
retained ID dedupes its effect. Restart reclaims expired leases without resetting
budgets; exhausted failures require deliberate recovery. Connects
[receipts](receipts.md), [recovery](recovery.md) and [lifecycle](lifecycle.md).
