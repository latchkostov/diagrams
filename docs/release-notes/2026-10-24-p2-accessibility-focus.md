## Accessibility and focus

Simulation authoring announces blocking validation in a stable status region. Invalid fields identify their names, accepted numeric limits and units, or missing targets; each field and the disabled Save/Run controls reference the explanation.

Cold renames preserve pasted text in order with typing, leave other focused fields alone and release keyboard ownership if a peer deletes the target before its inspector arrives. Queued reverse navigation follows the pending readout destination through the interaction controller.

Clear everything keeps its pending control focusable, visibly disabled and marked busy. Peer-deletion menu announcements already existed; regressions now cover nodes, connections and boundaries without adding another notification.

Next.js keeps its brand artwork and uses a neutral #777777 interaction accent that remains visible in both themes. Builds without collaboration endpoints offer file/configuration guidance and omit ineffective Retry actions, including for joiners who have no document yet.

## Output parity

Two goldens change intentionally:

- `node/exports/drawio/aws-serverless-orders.drawio`: the Next.js storefront's stroke changes from #000000 to #777777 and its tinted fill from #0000001A to #7777771A.
- `node/i18n/catalogs.json`: seven English validation/recovery messages add the workspaceValidation and workspaceRoom namespaces; message counts and English fallback counts/hashes change accordingly across languages. Existing translated messages stay unchanged.

The complete parity run compared 3,147 goldens: these were its only two differences; all 108 browser parity tests passed. The targeted update and recheck passed 482 tests and 1,097 goldens with zero differences. Simulation, planning and routing goldens remain unchanged.

## Verification

Each fix has targeted regressions, checked with the fix temporarily removed. Existing menu-announcement and wipe-focus behavior was deliberately broken to prove those regressions. Browser assertions use state and fake clocks. Light and dark accessibility checks remain clean. The Linux load gate passed five repetitions of the affected regressions and their annotation, drawing, viewport, platform and inspector neighbors: 555 passed, zero failed/flaky/skipped.

The measured canvas first view is 374,511 gzip bytes, down from 374,588; budgets are unchanged. Interaction debug journals remain available in development/E2E builds and are omitted from production. No new simulation, planning or stencil feature was added, so the existing public Next.js example supplies coverage.

## Upstream sync

Rebased onto origin/master at 8e58be7e after its load-shedding merge. The only conflict was the i18n catalog golden: regeneration from the upstream golden adds this batch's seven messages (3,080 to 3,087) and preserves its new namespaces. The export/i18n recheck remains clean. Bundle numbers above compare against that updated base.
