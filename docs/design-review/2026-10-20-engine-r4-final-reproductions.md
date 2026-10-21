## Engine R4 final UX review

This round repairs three simulation behaviors without adding chrome or settings. Partial CPU
completion agrees with the capacity shown to users; draining replicas stop consuming CPU at
their grace deadline; same-tick recovery and resource enabling finish playback instead of
throwing. CPU units and existing inspector controls stay the same.

Existing public request and CPU examples already show these behaviors. This is a correction
to R4 rather than a new simulation, planning or stencil feature, so no new showcase is needed.
Shape focus and connector geometry from the master merge remain outside the approved scope.
