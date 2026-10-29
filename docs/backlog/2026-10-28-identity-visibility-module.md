## Extract identity visibility without growing distributed artifacts

R-c2b676a2e1 remains conditional on a byte-neutral or cheaper viewer and skill ZIP. The P2 batch tried a separate identity visibility policy with a viewer module stub, replacing the component-source slice in `scripts/interactive-viewer.ts`.

The closest measured candidate added 22 raw viewer bytes, 7 gzip bytes and 2 bytes to the independently compressed viewer ZIP entry (all other skill entries unchanged). Baseline: 1,872,644 raw / 621,199 gzip / 599,776 ZIP-entry bytes; candidate: 1,872,666 / 621,206 / 599,778. Two other factory variants also grew the ZIP. The extraction was rejected and the existing viewer specialization retained. Do not raise budgets or reserves to land this cleanup.
