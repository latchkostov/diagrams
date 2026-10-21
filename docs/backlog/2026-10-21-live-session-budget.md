## Live session bundle over its budget (PR #225)

`bundle/liveSession/gzip` (scripts/bench/bundle.mjs, budget 135,000 B) measured 134,863 B early in PR #225, then
137,601 B and 138,039 B after its later fix rounds. Most of the jump was a static import of the planning text (and
the capacity planning modules behind it) only for the fix toast's label; the toast now repeats the callout button's
own words, which brings the chunk to 136,510 B. The remaining ~1.5 kB is the feature's own code in the live chunk
(fix application and toasts, the verification trail and its shared replay dispatcher, timeout-loss attribution).

Getting under the budget needs an owner decision: raise the live session budget on purpose, or move existing live
code behind a lazy chunk (for example the thread-fix application, already behind a lazily loaded callout, or slow
motion). Lazy trims have broken focus and export before, so either move needs its own review and a hold-the-chunk test.
