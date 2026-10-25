## Skill ZIP trim: UX review

This packaging change adds no controls or visible behavior. Both viewer formats
retain planning hover readouts, routing and autoscaling playback. Inspector routing
and autoscaling editors remain available in the application; they cannot open in
the read-only viewers. Their viewer-only stubs follow the existing exclusion
mechanism. Offline export, password protection, recording, pan and zoom retain
their existing implementations. The editors' shared planning stylesheet stays in
its original dependency position: the viewer's complete style block is byte-identical
to master. No chrome-budget or vocabulary changes are needed.
