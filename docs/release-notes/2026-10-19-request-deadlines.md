## Request deadlines

Request connections in the waiting model now offer **Timeout** beside **While waiting**.
A deadline fails the caller through its existing retry, dead-letter and drop paths, and carries
the failure upstream, including gateway 504 replies. Blocking calls release their threads;
non-blocking calls queue a failure continuation. The provider keeps working: late replies are
discarded and counted. Refusals still fail waiting callers. Historical models retain their behavior.
Planning uses the same deadline outcome and propagates fail-fast joins upstream. Sampled calls
distinguish logical response time from synthetic residence, including zero-replica callees.

Live shows **✕ N timed out** on the connection and timeout/late counts in the caller's hover.
An exhausted caller waiting on a stalled, down or cut dependency offers **Add a timeout** before
freeing threads. The fix respects saved overrides, drafts, slow motion and Undo. Busy-thread
scaling, pools and new Checks remain for the later requests-that-wait PRs.

**A slow payment provider** compares no timeout with a 600 ms timeout, with the provider slowing
tenfold at three seconds. Both lessons appear within ten seconds: saturation versus bounded waiting.
The approved 120 requests/s, 100 threads, 2 s slowed provider and 5 s gateway timeout are preserved;
gateway 504s follow the growing queue later than the design's approximate eight-second prediction.

## Output parity

Every older diagram-output golden, including the existing W1 corpus, stays unchanged. New goldens
cover the payment example and `w1-deadline`: blocking/non-blocking deadlines at scales 1 and 10,
logical replies, failures and late replies, plus their planning, checks/evidence, agent, trace,
native/draw.io/Mermaid/HTML export and layout outputs. The payment example adds browser render and
layout goldens and a routing unit snapshot.

Four existing shared goldens change intentionally:

- `node/i18n/catalogs.json`: ten new English messages and their catalog hashes/fallback counts.
- `node/skill/public-schemas.json`: diagram v1/v2 schema hashes and sizes for the `timedOut` metric.
- `node/skill/current-stencils.json`: generated reference hash changes because the public example
  changes the most-used-stencils ordering.
- `node/skill/validate.txt`: the validation transcript includes the new frozen deadline corpus.

No golden is changed to accommodate an unexpected failure.
