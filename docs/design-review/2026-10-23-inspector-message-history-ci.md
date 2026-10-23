## Inspector Message history compatibility review

Keep the existing Message delivery chart and Delivered vitals free of Request retry semantics.
Preserve bidi isolation around complete rates and the unavailable failure-rate display when
success accounting is missing. The CI assertion now requires the isolation mark before its
nonzero rate; no controls, layout, disclosure defaults or visible text change.
