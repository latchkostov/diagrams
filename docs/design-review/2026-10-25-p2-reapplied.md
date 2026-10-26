## Rate limit and identity follow-ups after #350

The existing Rate limit field stays in the Inspector's Simulation section, with no additional
toolbar or menu controls. Its units and clearing instructions remain visible and associated
with the field. At the quota ceiling, an adjacent accessible explanation states the recovery
action. Bulk editing applies that ceiling regardless of selection order, while existing local
rates remain editable and clearable.

Repeated edits preserve quota order and every unrelated budget. Live browser coverage checks
that traffic continues while edits take effect. The existing public example remains sufficient
for this correction. Rule identity and bounded planning work add no chrome. Protected-control
placement still responds to membership and geometry changes without rescanning for animated
waiting meters.

Rejected: porting #345's naming or keyboard changes, altering tutorial behavior, dropping quotas
to make room, changing IDs during ordinary reads, rescanning the whole rule list for every repair,
or loosening assertions. #350 owns naming. Identity repairs follow connected fallback/owner groups
once, including newly freed bases, and preserve unrelated authored rows.

## Verification

The three targeted unit files pass all 44 tests. Eleven deliberate unit mutations are rejected,
including late planning bounds, omitted bulk disablement and a quadratic identity repair. Both
browser mutations fail their intended assertions: the missing accessible description and a
reordered quota displaying its sibling's value. The R-12b86d777e regression also fails against
#345's one-pass repair before the transitive correction.

The study-cells solution passes ten production Chromium repetitions with four workers. All four
inline-edit cases pass natively and in each of five Linux repetitions with four workers on four
container CPUs: 20 passed, zero failed or flaky. The quick subset gate reports `gate_failures=0`.
No full gate or full suite runs in this fix round.

Targeted planning/admission/i18n parity passes 179 tests and compares 180 goldens with zero
differences after the one intentional catalog update explained in the release fragment.
Production build and size pass: entry gzip is 108.1 kB against 123.5 kB. Regeneration and i18n
validation report zero errors; existing missing/stale translation warnings remain.
