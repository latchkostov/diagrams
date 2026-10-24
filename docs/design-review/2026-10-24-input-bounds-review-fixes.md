## PR 274 review fixes

The page picker reports early draw.io conversion failures through the existing unsuccessful import outcome and
error toast, making the reason visible and announced. A failed selection leaves the picker available to choose a
smaller page. No controls, layout, focus or timing behavior changed. Collaboration bookkeeping changes add no UI.

Keep the early node-budget check: deferring validation would restore the expensive spacing pass on oversized pages.
Keep conservative pending-dependency charges until pending state drains: serialized size omits the missing-client
map and cannot prove that those charges are reclaimable. Epoch turnover clears sender slots only; room charges
remain. Targeted tests cover the deferred failure, sender turnover and retained room bounds.
