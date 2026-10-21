## Request deadlines on the refactored engine

PR #197's inspector, callouts, schemas, translations, planning, public payment lesson and browser
coverage are retained. Deadline execution is rebuilt on the R1–R4 attempt timeline and sampled
ledger. Expiry is unscaled, equal-time replies lose, and an attempt's outcome is written once.
Paused callers decide at expiry and commit on resume; downstream work continues and late replies
are counted. Settled joins remove their deadline timers through the indexed heap. Timeout pool
reservations retire with the configured logical deadline; thread changes use
`executionReservations.ts`, including the pre-admission deadline settlement phase. A 504 returned
after a child's continuation retains the parent's normal reply-phase turnaround; its status code
does not make it a direct deadline event.

Generated example metadata uses compact rows, integer tenths and a shared accent table, decoded
to exactly the existing objects. This keeps the new example inside the unchanged startup/canvas
budgets. The public example, its traffic and its two lessons are unchanged from #197.

## Output parity

The 60 added goldens cover the public payment example and deadline corpus. Every existing diagram
output, every pre-W1 output and every scale-one deadline output stays unchanged. Relative to the
original PR's new goldens, four scale-ten records change:

- `node/sim/corpus-w1-deadline/blocking-10.json`: first-wave replies reduce end-to-end p50
  860→820 ms and mean 715→685 ms; caller wait p50 falls 570→550 ms. Event fingerprints and the
  decaying final throughput sample follow the earlier schedule; final outcome totals stay the same.
- `node/sim/corpus-w1-deadline/non-blocking-10.json`: end-to-end p50 falls 340→320 ms and mean
  325→310 ms; caller wait p50 falls 130→110 ms. Event fingerprints and final throughput sampling
  follow the earlier schedule, with the same final outcome totals.
- `node/waits/w1-deadline/blocking-10.json`: caller occupancy is 0.4 represented dots (four real
  threads), and logical timeout failures arrive earlier, completing all four dots by 1.1 s.
- `node/waits/w1-deadline/non-blocking-10.json`: the first 100 ms admits four downstream dots
  instead of three; by 200 ms three failure continuations finish instead of two. Caller occupancy
  is 0.4 dots, and late replies follow the earlier downstream schedule.

The allowed payment free-play simulation and trace require no changes from the original PR.
Six shared contract/catalog records change relative to master: `node/agent/tools.json` adds the
shared expectation metrics and nullable deadline overrides; `node/skill/public-schemas.json`
records those schema contracts; `node/skill/files.json` records the regenerated spec fingerprint;
`node/skill/current-stencils.json` records the new example's ranking fingerprint;
`node/skill/validate.txt` adds the corpus validation line; `node/i18n/catalogs.json` adds ten
English messages, with matching hashes and fallback counts. No golden is changed for an
unexpected failure.
