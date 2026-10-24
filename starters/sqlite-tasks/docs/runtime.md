# Node runtime and development

src/index.ts uses nodeRuntime after configuration/resource startup and logs the
actual URL. pnpm dev uses tsx watch over source; restart can change an ephemeral
port, so read the newest listening record. pnpm build bundles application modules
for Node while package imports remain external; pnpm start runs dist/index.js.
Source and compiled entrypoints use the same project data/environment paths.
Native signals await application close. See [configuration](configuration.md),
[lifecycle](lifecycle.md) and [testing](testing.md).
