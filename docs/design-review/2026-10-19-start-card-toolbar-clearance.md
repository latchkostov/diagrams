## Start card toolbar clearance

The start card's horizontal clearance now covers the toolbar's 16px inset and
56px outer width, with an 8px gap. It remains centred and keeps its existing
maximum width on wider panes. The regression checks its action row, toolbar
separation and containment with the AI panel open at 1024, 1280 and 1440px.

Automatic toolbar collapse and runtime height measurement were rejected: reserving
the toolbar's existing horizontal footprint fixes the overlap without hiding
controls, adding state or changing the interaction. No controls or text were added.
