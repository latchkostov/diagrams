## Scope

Designer-agent review of the T04 notification recovery and T11/T17 Checks changes against
`docs/UX-PRINCIPLES.md`. This is a source and interaction-contract review; browser layout,
held-chunk behavior and Arabic rendering require the implementation's production E2E checks.

## Chrome and guidance

No new global control or menu item is added. Recovery retains the existing Retry action.
Incomplete message-path analysis becomes a warning with the plain title “Some message paths
need review,” reason-specific guidance and no element selection or Ignore here action.
Diagram-wide IDs remain distinct from element findings and saved element ignores.

The new guidance has Arabic translations and contains no interpolated authored identifiers,
so it adds no mixed-direction identifier boundary. Existing authored names in recovered
element findings retain their existing presentation path.

## Findings and disposition

- Resolved: a bounded target result retains a compact incomplete-analysis line when findings
  were omitted or work was unchecked. It points to All checks instead of implying that the
  displayed subset is complete.
- Resolved: merged listed and recovered findings use the canonical Checks ordering, so warnings
  precede suggestions and rule and reading order remain consistent.
- Resolved: targeted recovery initially shows three compact rows. More reveals
  another three on demand; All checks remains available. Complete diagram results retain the
  existing path without an extra target-analysis wrapper.

These additions stay inside the downloaded Checks UI. Their prose uses the lazy `workspaceChecks`
catalog and has Arabic translations. No additional global chrome or menu level is introduced.
The three original UX findings are resolved at source review; browser verification remains with
the implementation gate.

Partial markers are limited to enabled checks. The targeted region is a scroll-snap destination
that clears the sticky Properties identity, keeping its pointer actions reachable after naming
or export. Optional guidance uses the same numeric translation lookups as the other Checks copy.

## Recovery contract

The shell subscribes to input ownership so Retry can receive focus when a task starts after
recovery appears. Focus cleanup checks the current owner before restoring focus. Dialog
feedback rechecks placement on viewport shrink and preserves the panel's control positions.
Production browser regressions should cover keyboard retry, later focus ownership and a
viewport shrink after recovery has already appeared.
