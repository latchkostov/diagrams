## Shaped lines follow shared node moves

Moving both ends of a shaped line together now carries its bends, including box selections,
boundary drags, nudges, alignment, distribution and Alt-drag copies. The line follows during a
drag; its saved bends change only on drop, in the move's undo step. Moving one end or arranging
the ends by different amounts keeps the bends in place and rejoins the end legs.

Auto-layout and Tidy up reset shaped lines incident to nodes that actually moved. A notice says
how many lines went back to automatic and offers Undo for the layout and bends together. Fixed
attachment sides stay as chosen. Duplicate and paste keep their existing bend offsets.

Only `tests/parity/goldens/node/i18n/corpus-hand-shaped-lines.json` changes: the new plural reset
notice adds one message and one English fallback per translated language in the existing route
shaping message area. Read-only exports exclude node-drag editing code to keep the fixed skill ZIP budget.
All diagram, routing, simulation, export and image goldens remain unchanged.
