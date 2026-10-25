## Escape ownership during pending naming

The interaction controller now gives Escape to dialogs, menus and naming before transient cards.
The editor-mode machine enters naming when its field is requested, including a held download, and
leaves it when input finishes or the request is abandoned. The type-ahead capture delegates Escape to
the controller, so listener registration order cannot change the owner.

Escape before typing cancels the pending request. Escape after typing preserves the existing save
and focus-return behavior. Mounted name fields retain their own commit behavior, and read-only
viewer cards still dismiss with Escape. No chrome, controls, copy or new focus destinations were added.

Rejected a card-local key listener, effects with ownership flags, test delays and relaxed assertions:
ownership belongs to the controller and mode machine. Regressions cover both listener orders, modal
precedence and explicitly open tooltips with held connection chunks, before and after typing.

## Mutation check

Restoring card-first Escape dispatch makes all four tooltip/held-chunk browser regressions fail at
the naming-finished assertion. It also fails both controller cases and both lifecycle registration
orders. Restoring the intended precedence passes the targeted 13-case browser run. Bundle splitting
and its existing headroom floors pass without changes to their assertions.
