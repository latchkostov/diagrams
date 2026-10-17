## Managed admission performance (P3 review, 2026-10-14)

- Compile endpoint lookups, quota authorities, signatures, keys and charge order once per configuration.
  The current bounded helper rebuilds these on each sampled attempt; the reviewer measured roughly
  430–440 ms for 10,000 attempts with 32 shared quotas. Keep request-time costs and simulation-clock
  bucket/reservation updates dynamic, preserve spent credit across edits, and guard complexity with
  operation counts or same-run growth. This is a P2 optimization; the correctness fixes remain in P3.
