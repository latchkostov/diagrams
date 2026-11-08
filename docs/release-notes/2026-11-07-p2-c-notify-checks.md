## Notifications and Checks

Dialog notifications keep task progress current while another notification holds focus or a press.
Replaced or dismissed notifications release their resources immediately, including while the notification
renderer is still downloading. Recovery Retry takes focus when a blocking task starts, stays reachable
when the window shrinks and returns focus to the page owner when removed.

Properties can recover request findings omitted from the whole-diagram result. Targeted worker and cache
requests retain the existing output and replay limits, cancel abandoned work and support verified fixes.
Older workers without targeted replies use scoped fallback analysis. Recovered warnings come first;
Properties initially shows three findings, with more on demand and visible guidance for partial analysis.
Complete results retain the existing rendering path.
Cancellation releases the waiting reader immediately and cancels queued target work. An already
running synchronous worker check may finish within its existing bound; its abandoned reply is discarded.

Incomplete message-path analysis now shows a reason-specific warning and manual guidance. Diagram-wide
finding IDs cannot collide with element IDs, evidence merges or saved element ignores. Arabic guidance
loads with Checks; no global controls or menu items were added.

## Batch disposition

- T04.01 fixed: progress updates match shown and waiting notifications by ID.
- T04.02 fixed: pending notification replacement, dismissal and closed-dialog ownership dispose promptly.
- T04.03 fixed: recovery observes task input ownership after mounting and preserves later focus ownership.
- T04.04 fixed: recovery repositions on viewport shrink.
- T04.05 fixed: removing a focused recovery action restores its valid page owner.
- T11.01 fixed: bounded target requests, separate cache entries, cancellation and verified-fix rechecks.
- T17.01 fixed: distinct diagram identities and translated, reason-specific visible guidance.
- T17.02 fixed: restored warning, ignore/reload and production-budget regressions.

Each batch's new regression was checked against temporarily restored pre-fix implementation and failed.
No item needs a product decision. No output, replay, bundle or checkpoint limit was raised.

## Output parity

Only `node/i18n/catalogs.json` changes. Every locale gains the four new Checks guidance messages and
the `workspaceChecks` digest; untranslated locales use English fallback. Arabic supplies all four
translations and the existing timeline-review sentence, changing its `messageTypes` digest too. Simulation, planning,
checks/evidence, exports, layout and browser goldens remain unchanged.

## Decisions

Keep existing element finding IDs and saved ignores; use a separate diagram prefix rather than restricting
valid imported element IDs. Keep safety verification on the whole graph: a recovered finding on a graph
outside the existing replay budget offers no speculative fix. Keep optional analysis and its translations
in the downloaded Checks surface rather than increasing startup work or core-locale limits.
