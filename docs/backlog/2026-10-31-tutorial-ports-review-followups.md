## PR 402 remaining observation-port review findings

- R-4223a6f7bd: publish dock facts only when their values or document identity change, avoiding repeated
  edge traversals while panning and zooming.
- R-fd7225032d: bind collaboration membership observations to the mounted room editor while keeping the
  initiating source for pending-work cancellation. Assert the leave identity matches the room document.
- R-bbf6cf482a: preserve authored keyboard solutions and bypass pointer translation when a variant is
  explicitly provided, including unsupported pointer gestures.
- R-8ecc02383f: keep a runner connected while real AI Apply and collaboration join actions complete their
  steps; rejected and cancelled actions must leave the step active.
- R-4b0ed35f5a: await deterministic settlement of held draw.io exports, including icon work, before the
  browser cancellation test asserts no download or success observation. Current unit cancellation
  regressions await the real pending writer and sequence conversion; the browser settlement gap remains.

The save data-loss findings and sequence PNG ownership finding R-db53f80127 are fixed separately in
this round. These remaining P2s are queued to keep the save fix focused.
