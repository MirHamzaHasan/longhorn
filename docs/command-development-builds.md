# Coordinated builds and generation admission

Owner: command-app build.config.mjs and dev.mjs. Connects
[source development](command-source-development.md), [lifetime](command-development-lifecycle.md)
and [proof](command-development-testing.md).

The existing app, browser and receiver esbuild settings now live in one editable
configuration module. One-off build retains all three targets and cleans the
project's own dist directory. The app watcher selects app+console; the receiver
watcher selects receiver only. Separate directories let both development owners
run together. A one-off build must run after they stop.

Node recursive filesystem watches cover each role's source directories, including
new nested modules and deletions. App private profiles use file-stat polling at
200 ms so atomic replacement and absent-file creation are observed. Build/dependency
configuration is fixed for one watcher lifetime and requires an explicit restart.
There is no persistent watch of dist, data or framework dependencies.

Source events increment a local revision and reset a 100-ms debounce. One owned
sequence compiles a selected revision. App and browser builds use write=false and
both settle before success is considered, even if one fails first. A failed or
superseded build publishes no outputs and admits no new child. An initial compile
failure leaves the watcher available for a fix; it cannot use a preexisting dist
host as a substitute for compiling the requested source.

After a usable build, the owner drains the old child before writing. It rechecks
the observed revision after native close and after output writes. New edits during
that interval wait for another usable generation instead of launching stale work.
There can be a listener gap while the old child drains or the next generation
compiles. Files are written after the owned child exits; this is not a directory
transaction against arbitrary external writers. One owner per role is the contract.

No schema, domain source, runtime adapter or package dependency changes are needed.
The checked CLI template requires these tools and its generated development guide;
both CLI-created apps and standalone archives use this same recipe.
