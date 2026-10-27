## Workbench visual tuning

Applied the latest round-6 values to the bezel, rail labels, dock inputs and selects, section summaries, description grid, readouts, run chart, numbered tags and start card. Numeric UI uses tabular Mona Sans; code faces remain for ids, keys and code fields. Input values retain full-strength ink.

Phone note controls have visible 44 px boundaries. The sheet receives keyboard focus and returns it to Read note on close or Escape. Rail arrows visit visible tools and More. The note scrim preserves the narrated cards and pins; its dark opacity is 27%, matching the light theme's 30% overlay on a mid-grey calibration surface. Retry glyphs use warning ink independently of annotation words. Call annotations follow their edge’s frame rule: they slide fully inside the frame or hide, including when the caller is pinned. Retry narration follows the overloaded service named by the status strip; its corrective action remains on the caller that owns the policy.

## Validation and parity

The new keyboard and note-boundary regressions failed before their fixes. The token contrast and call-pill unit tests pass. The boundary token that changes measured frame footprints was moved into the amended step 12, where output recording is allowed. Step 13 keeps the goldens unchanged; no test ids move.

## Rendering and moved-surface checks

Frame-chip titles subscribe with the editor update instead of adding a deferred React commit per rename. The hot label row avoids one redundant component reconciliation. The existing checks typing limits remain unchanged. Properties tests expand their disclosure only when it is closed; Checks action tests wait for the dock resize/refit before exercising their original actions.
