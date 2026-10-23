# Runnable operator accounts demo

Owner: `scripts/demo-operator-accounts.mjs`. Connects [account HTTP](account-operations.md),
[trusted provisioning](operator-provisioning.md), native PostgreSQL and the existing
Worker command consumer/receipt Object.

```sh
pnpm demo:operator-accounts
```

The host builds the workspace, creates an owned temporary PostgreSQL cluster with
restricted roles, deploys the operations profile and starts an actual local broker
and production receipt consumer. HTTP listens at http://127.0.0.1:3010 by default.
This demo is ephemeral: Ctrl+C drains the app and removes its database/Objects.
Open http://127.0.0.1:3010/console for the working browser flow, including account
creation, history, receipts and operator recovery. See the [complete walkthrough](command-application.md).
PORT may select another port; AUTH_ORIGIN must be the exact trusted loopback
origin. PORT=0 requires an explicit AUTH_ORIGIN. The logged URL gives the listener.

Register two accounts through POST /account/register with username/password
(minimum 15 password characters), then sign in through POST /account/login.
Send Origin: http://127.0.0.1:3010 on POSTs and keep each Set-Cookie in a separate
client cookie jar. Members can POST /account/commands with, for example,
{"id":"first-command","numbers":[2,4,8]}. The returned command/delivery IDs connect
to its protected read routes and computed receipt. Retries with the same request
key/input return the original IDs.

The trusted terminal accepts these commands:

| Command | Effect |
| --- | --- |
| grant alice | Add numbers-operator and revoke Alice's existing sessions |
| revoke alice | Remove that role and revoke existing sessions |
| fail-publisher | Make new dispatch attempts fail before reaching the broker |
| restore-publisher | Resume actual broker sends |

After grant, sign in again as Alice. To exercise recovery, fail the publisher,
create a command and wait for its delivery to fail. Restore the publisher, inspect
GET /account/operations/deliveries, then POST /account/operations/deliveries/:id/retry
with its observed expectedMaxAttempts, additionalAttempts:1 and
reason:"provider-restored". Audit history records Alice's verified user ID; the
member reads one receipt under the original delivery ID. An unchanged grant does
not force another sign-in.

The host uses native scrypt and the actual broker binding. No default operator,
fake success response or cloud deployment is implied. Trusted controls serialize
and drain before owner connection release; startup signals also await acquisition
before cleanup. [The native gate](operator-accounts-testing.md) exercises the
HTTP/broker path and normal/startup signal cleanup without logging credentials.

For retained application/receipt data, use the separately configured
[persistent operator host](persistent-operator-host.md) and
[durable HTTP receiver](http-message-receiver.md). Their lifecycle does not own
or remove the user-provisioned PostgreSQL deployment.
