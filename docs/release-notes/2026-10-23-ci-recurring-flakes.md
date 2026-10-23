## CI: recurring import and live-view flakes

The Kubernetes linearity guard now measures the resource reader on 16 and 128 workloads,
with parsed YAML reused. It keeps the 8:1 input ratio and 24× growth limit, without
repeated diagram layout and validation under coverage. A deliberate quadratic resource
scan failed at 45.6×; the scan was removed after the check.

Live-view tests wait for the export notification before advancing its expiry clock,
and for slow-motion capture to release Play before checking replay controls. Downloads
can finish before their notification words arrive, and capture yields while recording
busy traffic; neither event establishes that the next assertion is ready.
Sync retained the export-notification wait and its held-download regression, which
landed independently in master with #248; an equivalent duplicate wait was removed.
The payment lesson's setup samples at 1, 3, …, 15 simulated seconds, preserving trouble's
ten-second trend window, and checks the simulation clock before its keyboard pause.
This avoids hundreds of rendered setup frames and excessive scrubber updates under load.
The Inputs guard case uses 1,200 orders/s at quarter capacity, which still offers Apply
fix while keeping background capture bounded. Its disabled/recovery assertions are unchanged.

No product behavior or exported output changes. Output parity checked 3,111 goldens:
zero changed, added, missing or stale.

## Verification

The reader guard passed 20 Linux coverage repetitions with growth between 7.7× and
8.9×. Its measured test work across those repetitions fell from 296.4 seconds for
the original guard to 29.7 seconds. The original guard passed all 20 local repeats;
its CI timeout was not reproduced locally. The deliberate quadratic scan failed
the ratio assertion rather than a timeout.
