# UTC cron expressions

Owner: `@longhornjs/scheduler/cron` (`CronExpression`). Connects to [durable schedules](scheduler.md).
This is a numeric five-field subset: minute, hour, day of month, month, weekday.
It evaluates UTC fields only and never executes commands or reads the host timezone.

```ts
const weekdays = new CronExpression('0 9 * * 1-5')
const next = weekdays.next(Date.now())       // strictly after supplied millisecond
const latest = weekdays.previous(Date.now()) // at/before supplied millisecond
```

Supported fields/ranges: minute 0–59, hour 0–23, day 1–31, month 1–12 and weekday
0–7 (0 and 7 are Sunday). Each field accepts `*`, comma lists, inclusive ascending
ranges, and `/step` on a range or wildcard. Positive steps up to 1000 stay inside
their field; `*/23` hours selects 00:00 and 23:00 each day. Single-number steps such
as `5/10`, names, aliases, seconds, question marks, L/W/#, randomization, timezones,
and trailing commands are rejected. Whitespace is normalized; numeric spellings
are retained in the immutable expression string.

When both day fields contain no asterisk, either matching day qualifies. When
either contains an asterisk (including a step), both field predicates must match.
The month/hour/minute predicates always apply. This follows the selected numeric
day/step conventions documented by [Cronie's crontab manual](https://github.com/cronie-crond/cronie/blob/master/man/crontab.5).
LongHorn implements its own bounded UTC subset; the supported syntax above defines
its compatibility boundary.

Matching is at UTC minute precision. next is strict: 09:00:00 at a matching minute
advances to a later occurrence; previous includes that minute and ignores its
seconds/milliseconds. next(-1) can return epoch zero. Other supported timestamps
are nonnegative safe integers within JavaScript's Date range. The scheduler uses
next(startAt - 1) for an inclusive explicit start.

Calendar search checks up to 366 * 9 days in either direction, selecting allowed
hours/minutes on matching dates. This covers the eight-year leap-day gap around a
non-leap century. Impossible dates such as February 30 resolve undefined within
that bound; schedule registration rejects an expression with no future occurrence.
At representable time boundaries there may be no next/previous occurrence.
UTC evaluation has no local daylight-saving transitions.

Tests cover strict/inclusive boundaries, lists/ranges/steps, weekend rollover,
Sunday aliases, day union/intersection, century leap rules, impossible calendars,
unsupported syntax and timestamp limits. The native scheduler fixture also checks
cron behavior on Node, Bun, Deno and actual workerd.
