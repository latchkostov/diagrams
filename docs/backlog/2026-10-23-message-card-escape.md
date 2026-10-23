## Message card Escape also clears the selection

When keyboard navigation focuses a flow edge and its message-types card opens, Escape dismisses the card and also clears the selection: `useCanvasShortcuts` handles Escape in window capture before the card's document-capture listener. Give the canvas one Escape stack that open tooltips join, so the innermost surface consumes the key. Dependency settings cards and node tooltips behave the same way today. The canvas first view has about 4 B of budget left after PR #247, so this needs a trim elsewhere in that chunk, or a lazy home for the stack.
