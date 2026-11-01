## Keep a finite scenario running during the paint measurement

Nightly 41316747450 at bef905c1c1cbaa07165d8aac75634c6486e79537 fails the Windows worker
low-zoom playback case at its strict simulation-clock progress assertion. The trace proves the
product has correctly completed the finite Black Friday scenario: live-play changes to done,
all six expectations pass, and its clock stands at 13,840 ms. It reaches that state during the
real-time navigation and camera setup before the measurement. Waiting longer for that completed
clock, or loosening its progress assertion, would be wrong.

The test now opens the scenario paused and starts playback after the initial view is placed and
the page clock is frozen. Playback stays running through both manual zoom transitions. Fake
frames advance until viewport movement and pending chip work both clear, allowing wheel-end and
the identity frame to settle. Geometry work consumes no uncontrolled simulation time; each interval explicitly
requires playing. All four existing measurement advances, strict progress assertions and exact
unchanged paint counts remain.
No scenario duration, deadline, timeout, tolerance, budget or skip changes. SVG export cases are
untouched.

The unchanged case passes all six local Windows executions on two CPUs; that local run does not
reproduce the native failure. The native trace supplies the before evidence. Fixed local and
dispatched results, including any reversion result, belong in the round-seven verification.

Temporarily removing only the paused-start URL flag fails both added fixture preconditions;
the exact repaired bytes are restored afterward. A variant that paused playback during zoom
is rejected because it reduces continuous-playback coverage. Frozen-clock variants also expose
the required wheel-end and chip-frame acknowledgements; the final fixture waits for both while
keeping playback running. No failed experiment is counted as accepted verification.
