## Latency memory and compact details review

The primary p95 badge and normal hover stay unchanged. The recording-limit disclosure is contextual:
it appears only when some message types contribute to the aggregate without their own distribution.
The aggregate still includes every successfully completed sampled path, so the readout never claims
to have lost aggregate samples or to provide complete per-type recording after the limit.

No toolbar control or setting is added. When a short viewport cannot fit the compact tooltip, it
reduces to the percentile strip and the existing full-details hint. Properties → Live details now
contains the full latency readout, including sampling, scope, breakdown and any recording-limit
disclosure. The browser regression uses actual latency content at 1280 × 460, asserts clearance for
the node and its badges, and opens Properties to verify the complete readout remains reachable.
Arabic and the expanded pseudo-locale keep their existing production-build coverage.

Rejected: increasing the per-node type cap or merely reducing the checkpoint count would retain
node × type × checkpoint growth. Dropping aggregate samples would obscure the population being
measured. Clamping a full-height tooltip over the node would preserve the accessibility issue;
the summary instead follows the existing progressive-disclosure pattern.
