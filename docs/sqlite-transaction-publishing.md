# SQLite transaction publishing

Owner: `SqliteQueueStore.enqueueInTransaction` through
`@longhornjs/queue/transaction`. Connects [typed producer coordination](queues.md),
[Node SQLite](sqlite.md), [executor ownership](transaction-executors.md) and
application repositories.

```ts
const queue = new Queue({ name: 'followups.v1', schema, store: new SqliteQueueStore(database) })
const result = await database.transaction(async (tx) => {
  await tx.execute({ sql: 'INSERT INTO business(id,value) VALUES(?,?)', args: [id, value] })
  return await enqueueInTransaction(queue, tx, { businessId: id })
})
```

The business table/schema above are application-owned. Include queueMigrations
once in the complete migration history. No extra outbox/table/trigger is introduced.
The store requires an original active transaction belonging to its exact Database
handle, then uses the existing insertSqliteJob primitive. It performs no root
database operation or nested write transaction. SQLite syntax/positional binds
and the provider's scalar policy remain unchanged.

The Queue coordinator performs schema transformation, JSON snapshot/size checks,
attempt/delay validation and ID/time creation. Provider insertion returns provisional
metadata; the caller's outer transaction must commit before reporting success.
A later business exception rolls back the job too. A caught accepted publication
failure still rejects completion and rolls back the business row.

Node SQLite joins accepted publishers before commit/rollback while retaining its
write lock and same-file ownership gate. Queue close can drain the publication
before the enclosing transaction ends; database close still owns native transaction
drain. Validators should be short/pure, with external checks performed before
opening a write transaction. Never issue manual BEGIN/COMMIT around this helper.

Separate processes are used for visibility tests because this adapter serializes
same-process handles through its file gate. The [native gate](transaction-publishing-testing.md)
observes neither row before commit, kills a writer before commit to prove rollback,
kills it after commit to prove durability, and runs competing producers. A consumer
then reads the committed business row from the published payload.

`enqueueInTransaction` is the application API. The store method and
insertSqliteJob remain provider primitives accepting trusted NewJob metadata;
calling primitives directly does not add coordinator validation or participant
ownership. For the same store protocol on Worker storage, see
[Object transaction publishing](object-transaction-publishing.md).
