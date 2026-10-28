## Pre-existing quick-add setup race in the connected-node insertion test

The #378 review-fix Linux gate failed `tests/e2e/flow-building.spec.ts:685`, “a connected node never splits an edge it's dropped on”, at the setup's `savedWhen` assertion on line 693: two edges were expected after Alt+ArrowUp, typing `redis`, Enter and Escape. The autosave stayed at one edge. The trace shows typing and Enter immediately following the shortcut, without waiting for the quick-add surface.

A clean `git archive origin/master` at `b4385de7fa7d90a040a35380dbf78802b8fa6833`, inside this worktree's ignored test output directory, reproduced the identical assertion in repeat two. Only `flow-building.spec.ts` ran, on the production E2E build in the same Linux container, Chromium, two workers, two repeats and zero retries. It used its own frozen dependency installation and ports 6730–6734.

SUMMARY: b4385de7fa7d90a040a35380dbf78802b8fa6833 | e2e={"passed":129,"failed":1,"flaky":0,"skipped":0}

Follow up by synchronizing this setup with quick-add readiness, retaining the edge-count and no-insertion assertions. The review fixes leave this pre-existing test unchanged; no timeout or assertion was relaxed.
