# Deno project launch configuration and permissions

Owners: [host.mjs](../starters/deno-sqlite-tasks/host.mjs) and
[start.mjs](../starters/deno-sqlite-tasks/start.mjs). These trusted Node project
tools acquire a configured Deno child; no Node adapter enters the application's
framework closure or shared code.

Each launch reads project .env then .env.local with Node's native parseEnv and
overlays six process keys: APP_NAME, HOST, PORT, LOG_LEVEL, DATABASE_PATH and
CACHE_TTL_MS. The compiled shared schema validates before any database directory
or child is acquired. Deno receives those application variables and disabled
runtime update checks, then validates its snapshot again. Parent environment is
not mutated or wholesale inherited. Direct Deno launches need explicit settings
and grants; node start.mjs applies this project policy even from another cwd.

The normal child gets read/write for the selected database's parent directory,
network access for HOST and reads of the six environment keys. :memory: receives
no filesystem grant. The SDK uses a unique owner-only permission JSON file beside
package.json with literal path arrays, preserving commas/spaces/#. It passes that
file's named permission set to pinned Deno. Deno currently marks this feature
experimental and emits an upstream warning; supported execution is verified with
2.9.6 rather than inferred for another runtime version.

Policy files contain grants, not environment values. Every normal child close,
failed spawn/startup and owned reload awaits their removal. Early parent signals
abort pending acquisition; shutdown joins a started child before returning.
Forced stop is reported as cleanup failure. Parent SIGKILL/machine loss may leave
an ignored policy file or child and still needs external supervision.

The installed gate runs a separate native probe under the live host's actual
policy. It checks selected-path access and actual outside write/environment/
network denial plus absence of subprocess permission. Shutdown and failed startup
leave no policy files. Environment files are reread per launch; they are not source
watch inputs. See [development](deno-sqlite-starter-development.md),
[project settings](../starters/deno-sqlite-tasks/docs/configuration.md),
[Deno permission sets](https://docs.deno.com/runtime/reference/deno_json/#permissions)
and [installed proof](deno-sqlite-starter-testing.md).
