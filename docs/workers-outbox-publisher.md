# Workers queue publisher adapter

Owner: `@longhorn/workers/outbox`, createQueuePublisher. Connects the
[portable publisher port](outbox.md), [queue consumer adapter](workers-queue-events.md),
[Object alarms](workers-sqlite-alarms.md) and [working pipeline](outbox-worker-example.md).

```ts
import { createQueuePublisher } from '@longhorn/workers/outbox'
const publisher = createQueuePublisher<Payload>(env.MESSAGES)
await outgoing.dispatchOnce(publisher)
```

The adapter takes a structural QueueProducerBinding with send(body,{contentType})
and returns a structurally compatible publisher. It imports no Outbox implementation,
native SQL driver or application. Applications explicitly connect that adapter to
their Outbox and broker binding. The optional entrypoint's JS/types ship in the
Workers framework archive without enabling a producer in the default starter.

publish sends the original `{id,topic,data}` envelope with contentType=json and
awaits the actual binding promise. The application ID is carried in the body;
broker delivery IDs are separate. Cloudflare documents that resolving send confirms
durable broker acceptance in its [JavaScript API](https://developers.cloudflare.com/queues/configuration/javascript-apis/).
It does not establish that a consumer has completed. The adapter ignores returned
broker metrics and exposes only successful acceptance/failure to the Outbox.

The context signal is checked before sending and after the real promise settles.
The binding has no AbortSignal argument, so an already running send remains owned
even after cancellation. There is no Promise.race timeout that abandons publication.
A rejection or interrupted local acknowledgement may retry with the same body ID.
Cloudflare's [delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
also permit duplicates, so the consumer dedupes the application envelope ID.

Queue payload limits include the envelope. The Outbox's default 64 KiB data bound
leaves room beneath the documented broker limit; custom larger payload budgets
must fit the broker's complete-message limit. Producer/broker/consumer bindings,
retry/DLQ configuration and credentials remain host-owned. The local example uses
the pinned Miniflare broker; local broker state is not presented as a durable
managed-cloud deployment. [Native proof](outbox-testing.md) uses real binding sends
and consumer events, including duplicate broker deliveries after producer death.
