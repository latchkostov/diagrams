## Resilience tutorials, batch 1

Add lessons for a retry storm, backoff with a retry budget, and circuit-breaker recovery.
They use the public retry-storm example's saved seeds, Faults and expectation outcomes.
End-of-run steps offer 8× playback so learners can compare the existing 60-second runs.

The rate-limit lesson is quarantined for owner decision pending: 4 (switching examples in
part 2). Its inline traffic/refusal portion is authored; the Rate Limiter also needs a
Rate limit inspector control before its quota can be taught as a learner edit.

No public example or simulation behavior changes. The only changed parity golden is
`node/i18n/catalogs.json`: tutorial-area hashes, message counts and English-fallback counts
reflect the new English lesson messages. Every other language area and all simulation,
export and browser goldens remain unchanged.
