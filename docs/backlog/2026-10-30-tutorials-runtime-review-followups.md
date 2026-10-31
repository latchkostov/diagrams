## PR #401 round 1 follow-ups

- **R-4ef5b06320:** Share protected-overlay discovery between coachmarks and existing callouts. Include Trace and floating Checks surfaces, retaining the exclusion for an overlay containing the target.
- **R-6f6d6eb5f8:** Add browser coverage for the rendered strip fallback when no tip fits: hint visible, tip hidden, controls reachable and camera unchanged; restoring room removes the hint.
- **R-9bd23e263b:** Filter tutorial layout mutation records to note expansion/insertion and relevant chrome visibility. Keep synchronous expansion measurement, use ResizeObservers for size changes and avoid unchanged CSS writes.
- **R-2e6f623628:** Strengthen phone note coverage with instruction-scrollport overlap and scrolling-to-end assertions, repeated with enlarged text and changed dock heights.
