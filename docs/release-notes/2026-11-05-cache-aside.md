## Look up the cache before calling the database

A Request can now run **Only when Product cache misses**. The caller first looks up
the cache, calls the database on a miss, and fills the item after a successful reply.
Blocking callers keep their thread across both phases. **One fetch per item** shares
a lease across readers; failed and timed-out database calls leave the item empty.

The connection Inspector keeps **When** inside its existing **Request details**
disclosure, with the active condition visible when collapsed. Arabic wording isolates
the cache name. Copying the lookup and database connections preserves their relationship;
a partial copy removes the missing condition and explains why.

Black Friday's Product cache now uses a ten-minute rule over 50,000 Typical items.
Its database Request uses the cache result instead of the old 10% share. The public
`w3-cache-aside` parity corpus covers sequential misses and shared leases.

## Verification

Focused engine, planning, model, copy, saved-simulation and property regressions pass.
Restoring the old engine fails five new behavior regressions; restoring the old
capacity analysis fails the new hold-time regression. Broader verification and the
intentional golden inventory are recorded after the final gate.
