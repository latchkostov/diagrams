## PR 408 round 1: remaining coach findings

- R-58cb913dc6: stop placement measurements while the coach is hosted in the completion handoff.
  Keep a lightweight host-removal observer so dismissing the handoff restores placement. Validate
  that live updates do not scan diagram geometry while the handoff owns the card.
- R-3ad126c8b6: exercise generated Keyboard grow, connect and reconnect routes through their real
  menus. Assert source, submenu, destination, search and naming targets through completion, so a
  nonexistent generated menu destination fails. Current recipe tests verify the solutions, and the
  round 1 fixes verify persistent requirements; neither replaces this target-by-target coverage.
