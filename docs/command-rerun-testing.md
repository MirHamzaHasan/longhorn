# Native command reuse verification

Owner: `scripts/verify-console.mjs`, pure number/viewer source cases and the
independent command application gate. Run `pnpm test:console` for both command and
account gates, or `pnpm test:command-app` for the relocated artifact.

The command gate owns native PostgreSQL, restricted runtime access, real scrypt,
TCP hosts, production broker/receipt code and Chromium. Successful command and
receipt responses are real. Fault injection holds an actual completed source read,
drops a real committed command response, and deliberately changes one owned test
row to malformed legacy JSON to verify current input policy. No fake successful
API response is used.

Verified behavior:

- Run again loads a protected source into a review; no command POST occurs until
  Create command. Deep-link reload preserves the admitted source values and link.
- Unchanged input creates a distinct command/request key/delivery and actual receipt
  with the same computation. Editing a copy yields a distinct result and preserves
  the original numbers/delivery.
- Losing a real accepted rerun response then manually retrying unchanged normalized
  input reuses its key and returns one committed command.
- An admitted operator source creates an operator-owned copy; members cannot read
  or copy that other account's result. Invalid/missing links do not expose a form.
- Malformed saved JSON fails closed without coercion or submission.
- A held real source response renders loading; navigation away prevents it from
  replacing the current page when released.
- Actual cross-account cookie switching rejects both an old review submission and
  old-view history reads, without creating a command or clearing the other cookie.
  The native test first reproduced the prior unfenced 201 before the fix.
- Keyboard form order, no horizontal overflow, light/dark layouts, reduced motion,
  existing error/expiry states and theme-only browser storage are retained.

The command gate now writes 91 screenshots and `accessibility.json` to ignored
`.artifacts/console` (`LONGHORN_QA_DIR` override). Six additional states contribute
24 captures: changed account, rerun review, network error, unavailable source,
invalid source and source loading. Two more review captures check 130% text in
both themes on phone width. Themes/widths and axe WCAG 2 A/AA and 2.1 A/AA
requirements follow [console verification](console-testing.md). The separate account
gate remains 58 captures. Physical-device assistive technology, other browser
engines and password-manager behavior remain manual checks.

Four pure number cases cover valid notation/bounds, invalid form values, independent
numeric copies and malformed saved structures. Three middleware cases cover viewer
matching/omission, mismatch/empty claims, static/no-cookie-clear errors and anonymous
claims. Root source tests and shipped independent-app tests include these cases.

The independently packed/frozen-installed application opens a pre-backup source
after actual restore/regrant/restart, reloads its review deep link and creates a
separate command/delivery/real receipt. It then verifies ordinary history and
existing scoped sign-out/password behavior using the same shipped assets.
See [reuse](command-rerun.md), [viewer binding](console-viewer-binding.md),
[archive gate](command-app-testing.md) and [feature index](features.md).
