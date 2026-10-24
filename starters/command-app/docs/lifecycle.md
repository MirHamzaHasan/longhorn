# Host lifecycle and dependencies

Owner: src/operator-host.ts and app.ts. The host creates typed runtime configuration,
registers the database and application services in DI and awaits startup before
listening. Fixed built assets are read from dist/console. Readiness checks schema
and protected receiver storage; dependency outage is separate from liveness.

Shutdown stops admission, drains HTTP and dispatcher work, then closes borrowed
transports/pool according to their owners. Signals during startup await acquired
resources before cleanup. Neither host owns/removes the provisioned database or
retained receipt directory. Connects [setup](setup.md), [delivery](delivery.md)
and [deployment](deployment.md). HTTP runtime credentials remain restricted.

Optional [request cleanup](request-cleanup.md) starts after database ownership and
drains its admitted prune/error observer before the pool closes. Default-off hosts
create no cleanup worker or timer.
