# Lifecycle

src/index.ts shares one startup promise per DB binding identity. Startup verifies
history/columns read-only and registers its database cleanup. Failure closes that
handle and clears the cache so a later request can recover after deployment.
Await all database work within Fetch; app.close drains callers before cleanup.
Workers eviction does not promise a final application close. The local Node host
owns signals/native disposal. See [schema](schema.md) and [development](development.md).
