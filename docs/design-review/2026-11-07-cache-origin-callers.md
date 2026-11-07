## Cold-cache origin demand from propagation

Reviewed the corrected cold-start demand and replica recommendation against the Checks behavior
contract. Each cache-aside caller's conditional origin call is now attributed to that caller's own
origin, so a shared cache's warning names and sizes only the origin that cannot carry its traffic.
No controls, wording, layout or interaction changes are needed.

Cold origin demand is recorded where capacity propagation dispatches each fetch (the cache's own
forwarding, or the caller's conditional call), instead of a separate projection after the fact.
The projection therefore follows propagation's connection shares, filters, routing tables, health
checks and renamed lookups by construction.
