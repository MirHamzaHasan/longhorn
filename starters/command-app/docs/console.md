# Browser console

Owner: console/app.ts, app.css and src/console.ts. Fixed public assets use a strict
same-origin CSP with no inline/eval scripts. Private data arrives through guarded
relative API requests; text uses textContent. Only the theme is saved in browser
storage. Route changes cancel old reads; 401 clears private content and shows sign-in.

History, create/detail/receipt and operator delivery/audit screens use actual APIs.
Light/dark layouts adapt to narrow widths. Labels, keyboard focus, skip navigation,
larger text and automated accessibility checks were verified in Chromium. Real-device
assistive technology and other browser engines remain manual verification.
Connects [accounts](accounts.md), [commands](commands.md) and [recovery](recovery.md).
