## Review

The meter occupies the bottom edge inside the existing card footprint. Solid work, diagonal hatching and an hourglass distinguish work from waits without depending on colour. Pools up to 32 threads have countable cells; larger pools use proportions. Only callers on `p3-w1` show it; the busy chip appears at 80% occupancy.

Threads and the Ceiling equation teach the capacity limit in the existing hover and Inputs explanation. The hover keeps these rows when it compacts, with the existing scrolling behavior for long latency details. Nodes use an indexed connection-label map; the meter does no graph-wide searches per caller.

Model upgrade stays in Diagram properties. Its preview explains capacity changes, failures returning upstream and simulation-clock timing. Applying it is one history replacement, and Undo restores the complete prior document. The legacy download warns about lost wait semantics. No top-bar or Live-bar control was added.

## Staged decisions

The connection pill and the keep-capacity alternative require PR 2's non-blocking model and are deliberately deferred with it. This avoids presenting an alternative whose execution is not available in PR 1. The meter and hover remain useful on their own: the blocking example teaches why CPU scaling stays quiet.

## Verification

Production-browser coverage checks the meter, held count, named callee, Ceiling arithmetic, upgrade and Undo, and absence on older revisions. Operation-count coverage verifies that 10,000 held calls are not traversed by idle ticks, and that planning reads connections linearly. Final browser/load and parity results accompany the release note.

## Browser review

The production-browser screenshot was inspected. Threads and Ceiling now remain visible above latency when the hover compacts; the visibility assertion failed before the selector correction. The meter stays inside the card, its hatching is clear, and the existing busy chip remains in the strip. The Ceiling shows one rate unit and two decimal places where needed. No new bar button or setting was added.
