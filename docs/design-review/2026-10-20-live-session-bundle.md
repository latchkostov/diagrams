## Live session bundle UX review

The change adds no chrome, settings or user decisions. Node badges and heat-map chips remain in
Live's initial download; optional capacity and narration callouts use the existing lazy-component
loader and its failure/retry handling. Their words, actions and layout code are moved unchanged.
A narration still pauses in the controller while its component downloads, and Continue resumes it
once available. A capacity callout's download does not block playback or the heat map.

The held-download browser regressions cover both boundaries. Existing capacity, narration and
neighboring viewport/focus tests check the same placement, focus and camera contracts. Simulation
behavior and parity goldens must remain unchanged.

The first neighboring annotation-link Tab test pressed Tab before the lazy Markdown links existed,
as confirmed by its browser trace. It now waits for both rendered links before exercising the
unchanged forward/backward focus assertions. No camera or focus assertion was relaxed.
