## PR #340: modal opener and feedback lifecycle fixes

The settled toast layering design remains unchanged. Modal ownership is an independent contact
in the existing engagement machine: moving focus into the modal cannot release its toast opener.
Action-triggered modals register before the toast requests dismissal. Modal cleanup restores
inertness and focus before unregistering ownership; the store samples the actual returned focus
because React suppresses synthetic focus events during commit cleanup. Deferred dismissal waits
until that returned keyboard contact leaves too.

Dialog feedback snapshots include engagement and keep their identity while the layer, toast and
engagement remain unchanged. React can restart expiry after disengagement without an unrelated
render. Both toast buttons explicitly use the non-submitting button type inside Inject's form.

No controls, chrome, placement rules or timing delays were added to the app. Timer-based opener
retention and forced unrelated renders were rejected because ownership and observable engagement
express the actual lifecycle. Lab-only controls exercise the real palette, Toaster and InjectFrame.

Regression coverage includes an intervening arrival during a palette session, opening the palette
from the toast action itself, stable snapshot identity, hover release after the original expiry,
and activation of a stale Undo inside Inject without submitting or closing it. Reverting the store
and button fixes makes their focused unit regressions fail. Restoring the reviewed store and Toaster
also fails all three new browser regressions. With the fixes restored, all 42 toast unit tests and
51 targeted production-browser tests pass (toast, palette and custom injection cases).
