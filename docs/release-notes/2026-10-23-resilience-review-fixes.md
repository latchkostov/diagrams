## Resilience review fixes (#255)

Request failure percentages show “—” when settled successes are unavailable, including ordinary p3-w2
requests and older models. The helper exposes this as a discriminated union, and all Live consumers
handle it. Accounted requests retain their settled denominator, excluding local breaker rejections.
Call pills update when only successes or local rejection counts change.

Timeline events retain one roving Tab stop; the continuous slider is the next stop, with native
Arrow, Page Up/Down and Home/End controls. Retry-limit summaries include the configured minimum
(10 retries/s by default), and their expanded explanation describes the greater-of rule.

Budget recovery uses typed evidence scoped to the recovered request edge. It reports that edge's
successful request rate, rather than aggregate caller throughput. The retry-storm comparison now
reports 270.3/s instead of 300/s. It omits incident request losses because snapshots do not attribute
unique originating outcomes across paths; summing upstream drops would include unrelated traffic or
count propagated failures twice. Multiple-source and reversed-edge regressions guard this boundary.

## Output parity

Only `node/i18n/catalogs.json` intentionally changes: corrected retry-limit and recovery prose, plus
two unavailable-breaker messages, update resilience fingerprints, message counts and English fallback
counts. Diagram, simulation, planning, export and browser output goldens remain unchanged. The
standalone skill viewer is regenerated from the same Live changes.
