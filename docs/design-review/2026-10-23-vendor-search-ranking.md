## Vendor search regression review (2026-10-23, #251)

Keyboard search must keep familiar picks stable when the catalog grows. Matching relevance now resolves
before category enumeration, and established stencils win equal-relevance ties. Generic vendor compatibility
keywords stay discoverable while explicit product aliases retain their own relevance. No controls, chrome,
shortcuts or focus behavior change.

The storefront stays under Cloud, where its managed edge, storage and identity services belong. Updating
the pinned inventory records the added example without changing featured examples. Rejected changing the
keyboard test, changing its query or keystrokes, moving the example to another theme, raising byte budgets,
adding retries or re-recording simulation goldens: none addresses the underlying regressions.

## Bundle review after sync

The combined upstream code exceeded the first-canvas byte budget. Gallery category descriptions and
vendor-family hints now load with the stencil library, retaining the same translated getters and copy.
A build test prevents those descriptions from becoming a canvas dependency. This reduces download size
without changing a control, interaction, featured example or simulation output.
