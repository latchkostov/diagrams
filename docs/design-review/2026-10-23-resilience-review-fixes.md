## Resilience review round (#255)

Reviewed Request settings, failure readouts, recovery results, event navigation and continuous seeking
against the UX principles. No visible controls were added. One event Tab stop and one native slider
preserve both fast event navigation and arbitrary keyboard seeking, including beyond the last event.
The production-browser regression exercises Arrow, Page Up/Down and Home/End on a fixed-duration Lab
fixture, alongside pointer navigation and event focus.

The collapsed retry summary now teaches the real allowance, including its effective minimum. The
expanded explanation agrees. Unknown success counters display “—”; zero settled attempts with
accounting remain distinct from unavailable data. The Lab's settled-counter preview mounts the actual
memoized call pills and changes successes and local rejections without changing occupancy or routing.

## Evidence and rejected alternatives

Recovery is scoped to one Request edge, with its measured successful rate. Omitted incident losses
require unique originating-request evidence that the current snapshot lacks. Rejected both selecting
one upstream source and summing aggregate upstream node drops: source order and unrelated traffic
must not determine a request-loss claim. Engine accounting changes are outside this review round.

Each fix has regression coverage. Removing the availability guard fails both ordinary-model cases;
restoring upstream recovery inference fails the multi-source case. Temporarily reverting the retry
summary, slider Tab access and pill comparator changes makes all three browser regressions fail.
