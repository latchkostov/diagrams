## PR #206: preserve attempts through outage recovery

Recovered callers reacquire execution and request capacity without restarting latency or charging another attempt. Managed consumer retries retain their backoff deadline and renew quota exactly once when due. Continuations awaiting takeover have one admission path, so a saved down/up pair between reply settlement and the next tick drains normally.

Admission returns a named request/thread lease pair; paired release preserves sibling occupancy when retained weights differ. Regressions cover managed retry timing, a two-request quota, and saved recovery at scales 4 and 10.

Output parity: no goldens changed; scale-1 output remains identical. No tolerances or generators changed.
