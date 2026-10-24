# Deno host permissions

host.mjs validates the compiled application schema before choosing grants. The
child can read/write the configured database's parent directory, listen/connect
on the selected HOST and read six application environment keys. Memory databases
receive no filesystem grant. Normal hosts receive no subprocess/FFI grant.

Each launch writes a unique .longhorn-permissions-*.json beside package.json with
literal path arrays and owner-only mode, then passes its named permission set to
Deno. This preserves spaces, # and commas without command-line list splitting.
The selected file is removed after actual child close, including failed startup
and owned development replacement. Abrupt owner/process loss can leave a stale
ignored policy file; it contains grants, not environment values or credentials.

Pinned Deno currently labels named permission configuration experimental and
prints its upstream warning. Re-run the installed native gate when upgrading the
runtime. The Node launcher is trusted local tooling with normal Node privileges;
these grants constrain the Deno application, not the launcher or its author.

The shipped tests/permissions.mjs probe can run against a live launch's policy to
verify selected-path access and denial of outside writes, unrelated environment,
subprocesses and another network host. The installed distribution gate also checks
that shutdown removes all launch policy files. See [configuration](configuration.md),
[runtime](runtime.md) and [testing](testing.md).
