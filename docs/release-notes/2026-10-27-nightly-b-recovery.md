## Nightly recovery and development verification

Retrying a failed toast-renderer download in a short Share window keeps the dialog's controls in place
under development React's StrictMode. Recovery cleanup now restores both placement and panel height.
A focused StrictMode regression fails when the cleanup fix is removed.

Confluence framed-header tests use production HTML even in the dev-server lane. Production CSP stays
unchanged; the editor's other development tests still use Vite dev. This adds a production preview server
on `E2E_DEV_PORT` during dev-target runs, inside Playwright's existing server lifecycle.

## Nightly evidence

[The complete inventory](../backlog/2026-10-27-nightly-b-run-40577899574.md) covers all 23 failing jobs
and 81 distinct reported identities. Unresolved observations remain in the backlog and flake ledger;
computed titles that its declaration guard cannot recognize stay in the backlog. Passing Windows
replays do not resolve macOS-specific failures. The duplicate inspector key, held timeline interception
and browser skill-download fixes already exist on current master and pass their targeted checks.

Build ×3 repeats tests against one build. Shard 2/12 hit the job deadline; shard 11/12 reported Greek
rail-caption wrapping failures and then hit the deadline. Two sequential production builds emitted
524 files each with identical filenames and SHA-256 hashes, including the skill ZIP. No differing build
output was found, so no speculative bundler change was made. **No parity golden changed.**

A1 + A3 invariant shard 7/16 succeeded with 630 tests. There is no failing seed or engine counterexample
to hand to lane B. Native unit jobs were interrupted by their action deadlines, without a recorded
failed assertion; Windows completed 13,191 unit tests successfully before heavy tests were interrupted.

## Verification

- 42 targeted unit/build-contract tests pass, including the startup chunk contract and flake-ledger guards.
- 77 selected native failure cases pass on Windows across the initial replay and four isolated teardown
  reruns. Initial concurrent replays shared an output directory and produced trace-file errors; those
  are retained as failed local setup evidence, not product failures.
- The dev replay passes its targeted Undo, timeline, skill-download, imports, edge selection, toast and
  Confluence behaviors; both Confluence variants also pass isolated reruns. Its initial trace teardown
  error came from the same local output collision.
- Five Linux repetitions of the complete toast-loading and Confluence specs pass: 50 passed, zero failed,
  zero flaky, with eight workers and eight CPUs.
- The initial Linux rail probe passed both Greek identities but had four first-navigation 404s during
  a concurrent local build. The separate clean-output replay passes all 83 rail tests unchanged.
- Production build, entry/locale/viewer size budgets and regeneration checks pass. Regeneration changes
  no generated artifact; existing translation warnings remain, with zero i18n errors.
- Full output parity passes: 1,873 Node tests, 110 browser tests; 3,178 goldens, zero changed, added,
  missing or stale.
- One post-commit Linux full run passed Docker and static checks, but found two config assertions
  expecting the old dev-target server count (13,213 other unit tests passed). Those assertions now
  require the exact new port list and production URL mapping; all eight focused follow-up tests pass.
  Its heavy lane passed 950 tests, and build/size passed before shutdown completed during parity.
  The obsolete full run was stopped under the targeted-only fix-round rule. It is interrupted,
  not a passing full gate; PR CI still owns the final full verification.

The final static-check results are recorded in the PR. No timeout, retry, behavior assertion,
production security policy or simulation source was relaxed or changed.
