# Returning to a saved view after sign-in

Owner: rememberHistoryDestination, authPage and the validated console router.
Connects [view links](history-view-links.md), [viewer admission](console-viewer-binding.md),
[account boundary](console-security.md) and [native proof](history-view-link-testing.md).

A signed-out visitor opening an explicit command-list link sees Sign in while
the canonical selection stays in the fragment. Successful sign-in renders that
view, including when the destination equals the current hash and no hashchange
event would fire. Switching to Create account retains the same validated target,
and successful registration/login returns to that selection under the new account.

An ordinary protected-request 401 remembers the current valid selection, clears
private UI and uses the existing sign-in notice. Successful reauthentication
returns to the selection; the new account supplies the principal. Other private
pages can return to the most recent valid history view. Password/session sign-in
outcomes use the same internal view target and keep their existing no-replay and
secret-clearing behavior. Explicit Sign out clears the pending target and remembered
view, so ordinary subsequent sign-in starts at the default command list.

The pending target exists only in memory and is always built from the strict
scope/state/search-prefix serializer. No returnTo URL, owner ID, token, cursor or arbitrary path
is accepted from a link. Navigating to welcome clears the pending target. A full
reload of /login has no saved destination unless a valid view fragment is opened
again. A bookmarked command-list fragment remains independently reusable.

All requests still use the actual cookie, displayed-viewer claim and server gates.
A scope=all link cannot supply a role: a member remains denied after sign-in and
must explicitly choose the own-scope action. Existing switched-cookie handling
preserves the valid other-account cookie. No password, command numbers or credential form data is added to
the destination, browser storage or browser history.
