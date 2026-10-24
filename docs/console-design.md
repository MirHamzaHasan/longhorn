# Console concept and interaction rules

The LongHorn console is for the developer or operator running the command/receipt
example. Its one promise is to make a submitted command traceable through delivery,
result and deliberate recovery using the actual persisted account data.

The first screen explains that workflow and offers sign-in or account creation.
An authenticated member creates a command, browses owned history and opens detail
and computed receipts. A numbers-operator additionally inspects outgoing records,
adds a bounded retry allowance and reads the attributed audit. The [Account page](console-account.md) lets either role change its password,
then explains the required sign-in. User credentials
and roles remain owned by the existing server APIs; the browser never supplies
an actor, owner or service capability.

The visual kit uses system sans text, monospace IDs, one warm accent and semantic
failure/success colours accompanied by words. Light/dark tokens define grounds,
borders, text, focus, spacing and radii. The same navigation and data hierarchy
works at desktop and narrow widths. Loading, empty, expired-session, unavailable
receipt and stale-retry states remain visible and actionable.

Controls have visible labels, keyboard focus and at least 44px targets. Forms keep
errors next to their input and use a persistent live region for result notices.
Reduced motion has no functional dependency. Account secrets stay in the normal
HttpOnly cookie flow, not browser storage. Only the chosen theme is remembered.

No invented metrics, seeded success rows, external fonts, animation-dependent
feedback or dashboard statistics are needed. All displayed command values and
states come from API responses or explicitly entered numbers. Screens are verified
through real Chromium captures in light/dark, laptop/phone widths, keyboard use,
scaled text and automated accessibility checks. Real-device assistive technology
remains a separate manual verification boundary.
