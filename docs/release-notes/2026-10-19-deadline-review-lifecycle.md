## Request deadline review fixes

Logical deadlines now expire independently of sampled thread and connection residence. Cut and
paused dependencies time out at the same simulation times and represented counts at scales 1
and 10; down dependencies fail immediately at both scales. Nested callees can report their
logical response while retaining sampled resource occupancy.

Replies and terminal joins remove deadline timers through indexed heap removal. Checkpoints
retain live deadlines only. Fail-fast joins release sibling pool reservations and queued branch
messages, and a pool never dispatches a request that has reached its deadline. Downstream work
already dispatched still completes, with its late reply counted once.
Pending calls also use indexed removal: an expired queued message is cleaned up immediately
even while another successful sampled request retains the occupied pool slot.

Incomplete numeric input preserves the saved timeout and shows accessible feedback. Timeout
and discarded-reply counters remain visible in compact caller details. Clearing a saved timeout
override now explicitly disables it (`null`); omitting the override still inherits the diagram.
Agent simulation expectations share the complete metric list, including `timedOut`.

## Output parity

The intended changes are confined to W1 deadline/resource bookkeeping and shared agent contracts:

- `node/waits/w1-deadline/{blocking-10,non-blocking-10}.json` and
  `node/sim/corpus-w1-deadline/{blocking-10,non-blocking-10}.json`: logical timeouts and upstream
  failure responses occur at the configured deadline, with pool leases released independently
  of retained sampled caller occupancy.
- `node/waits/w1-held-drain/blocking.json`: terminating a held join releases its branch pool
  reservations immediately, so in-flight connection counts no longer include orphaned leases.
- `node/waits/w1-join-failure/blocking.json`: fail-fast settlement releases sibling pool leases
  immediately while already dispatched sibling work continues and its reply is discarded.
- `node/agent/tools.json`: caller deadlines accept explicit `null`, and simulation expectations
  accept the shared metrics, including `timedOut` and the previously omitted `rejected`.
- `node/skill/public-schemas.json`: schema sizes and hashes reflect nullable deadline overrides.
- `node/skill/files.json`: the generated skill specification's size/hash reflects these contracts.

Older simulation and diagram outputs remain unchanged. Cyclic deadline planning is tracked in
`docs/backlog/2026-10-19-deadline-cycle-planning.md`.
