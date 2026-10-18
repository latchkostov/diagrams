## Bounded latency recordings and short-window details

Latency now shares unchanged histogram buckets across checkpoints and copies a distribution only
when a later sample changes it. A run records at most 1,024 distinct node/type distributions (1 MiB of
live numeric bucket payload), in addition to one aggregate histogram per measured node. Extra types
continue contributing to the aggregate; the readout explicitly discloses that recording limit.
Budget allocation is checkpointed and reset on restart, preserving deterministic seek and replay.

The validated 200-sink × 64-type regression retains **156,672 bucket slots / 1,253,376 bytes
(1.20 MiB)** across 24 unchanged checkpoints, compared with **39,936,000 slots / 319,488,000 bytes
(304.69 MiB)** with the previous engine. These counts measure distinct bucket storage, excluding
object and array overhead; they are not total heap measurements. If every histogram changes
between captures, 24 checkpoints plus live state retain at most 25 versions: **29.88 MiB** of
bucket payload for this population. Aggregate recording remains available at every sink.

Short windows remeasure compact latency tooltips and, if necessary, show percentiles and the
existing Properties hint. Full latency details are available in Properties → Live details.
Tooltip entrances fade without changing measured geometry, and placement rounds away from the node
to keep badges clear at fractional zoom. Sequential two-worker tests verify alternating 100/900 ms
and 900/100 ms service times produce 1,000 ms root-to-node paths, never composed per-hop percentiles.

The only intended golden change is `node/i18n/catalogs.json`: one English fallback message for
aggregate-only type recording changes catalog counts and the latency area hashes. Simulation,
percentile, export, layout and render goldens remain unchanged; no diagram output is re-recorded.
