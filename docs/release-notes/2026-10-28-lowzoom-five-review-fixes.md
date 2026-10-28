## Low-zoom review fixes (#378)

Dense imported diagrams now share a bounded neighbour-search budget across chip fitting; when a search cannot finish, that chip stops expanding into gaps. Visible notes, shapes and text constrain chip expansion without becoming chips themselves.

Config connections retain their dependency identity and settings list when focused or selected below 60%. Changing language preserves chip widths, merged routes and direction marks.

Live traffic weights now sum rates only along shared route sections. Two 60 msg/s branches keep their own bucket 2 while their shared 120 msg/s trunk uses bucket 3. Separate lanes never inherit that traffic. Section membership storage is bounded for staggered imported routes.

No parity goldens change: exports and the natural drawing retain their existing output.

Shared-section strokes mount only in Live, preserving Edit's existing DOM reduction.
