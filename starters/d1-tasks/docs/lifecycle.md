# Lifecycle

src/index.ts shares one startup promise per DB binding identity. Startup verifies
history/columns read-only and registers its database cleanup. Failure closes that
handle and clears the cache so a later request can recover after deployment.
Await all database work within Fetch; app.close drains callers before cleanup.
Workers eviction does not promise a final application close. The local Node host
owns signals/native disposal. See [schema](schema.md) and [development](development.md).

Optional [task creation limits](request-limits.md) append the native batch bucket
schema to the complete deployment profile. The budget uses database time and counts
attempts before task validation/replay. A denied request creates no task/activity/
request record; closing drains accepted work before the borrowed D1 handle.
