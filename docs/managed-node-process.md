# Owned Node child process

Owner: [@longhorn/node/process](../runtimes/node/src/process.ts). This optional
entrypoint acquires one trusted direct executable and releases its actual process
lifetime. The Node HTTP adapter and shared packages do not import it. It connects
to [application lifecycle](lifecycle.md) through an application's returned cleanup.

```ts
import { startProcess } from '@longhorn/node/process'

app.onStart(async () => {
  const child = await startProcess({
    executable: '/absolute/path/to/trusted-service',
    args: ['--port', '0'], env: { SERVICE_MODE: 'local' },
    ready(line) {
      const record = JSON.parse(line)
      return record.message === 'ready' ? record : undefined
    },
  })
  // Use child.value only after protocol-specific validation in ready().
  return () => child.close()
})
```

The executable and cwd must be absolute. The caller chooses trusted code, argv,
environment and the synchronous readiness parser; they are not HTTP input. Spawn
uses no shell, ignores stdin and pipes stdout/stderr. Arguments and environment
are copied before spawning. Parent environment inheritance defaults to false;
inheritEnv enables an explicit snapshot and undefined overrides remove keys.
There are at most 256 arguments and 256 environment overrides, no NULs, valid
environment names and a 1 MiB combined executable/cwd/argv/environment budget.

| Option | Default / accepted range |
| --- | --- |
| startupTimeoutMs | 5000; 1–60000 |
| shutdownTimeoutMs | 10000; 1–60000 |
| maxOutputBytes | 65536; 1–4194304, combined stdout/stderr lifetime budget |
| maxLineBytes | 4096; 1–65536, readiness frame excluding newline |

Readiness parses complete UTF-8 stdout lines, including split multibyte characters
and CRLF. undefined keeps waiting. Malformed UTF-8, parser failure or an async
parser fails acquisition. Startup abort/deadline and output limits terminate the
child and await its actual close before rejecting. The acquisition signal is
removed after readiness; the resource owner then calls close. The parser is
trusted synchronous code, so a blocked JavaScript callback cannot be preempted.

The frozen handle exposes pid, value, state, stats(), exited and close(). Output
continues to count after readiness; crossing the lifetime budget terminates the
child. Contents are discarded and never attached to errors. Repeated close shares
one promise, sends SIGTERM, and waits for direct-child exit and owned pipe cleanup.
After the shutdown budget it sends SIGKILL, still waits for exit and reports
shutdown-timeout. Unexpected exit/output failure also makes close reject. An earlier
acquisition/output failure keeps its code if forced termination is later needed;
forced records that escalation. exited always resolves with code, signal, reason
and forced so owners can observe failure.
ProcessResourceError exposes only its fixed code/message.

Ownership covers the direct child. On POSIX it has a separate process group, but
signals target only its PID; descendants, daemonizing programs and parent crashes
need a host/service manager policy. No parent signal handlers or automatic restart
are installed. Closing pipe readers on direct-child exit prevents inherited
descendant pipes from retaining this resource indefinitely. Graceful signal
behavior is verified on macOS ARM64; Windows and Linux execution require their
own results. See [owned Rust resource](owned-native-reports.md),
[persistent host](native-jobs-host.md) and [verification](managed-process-testing.md).
