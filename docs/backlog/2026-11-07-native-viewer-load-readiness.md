## Combined native viewer and large-canvas load

During #439 round 1, seventeen browser specs shared six workers and eight CPUs.
The first repeat passed 253 cases, failed five and skipped one. The failed cases
were the bundle cache-runtime check, bundle autoscaling/replay, static free-play
viewer, viewer keyboard zoom and viewer reading-region keyboard scrolling in
`viewer-bundle.spec.ts`. Report: `tests/.output/g/rfiVAg7/e1`.

The snapshots show mounted React Flow nodes still hidden, without measured node
dimensions, and the camera pending its initial fit. No failed network response or
page error was captured. The second repeat was cancelled and its container and
servers stopped; there is no aggregate five-repeat summary for that attempt.

## Follow-up evidence

A focused viewer/typing run with temporary resize/frame counters passed all 31
runnable cases (one skipped). Those diagnostics were removed. All fifteen native
viewer, cache-aside, annotation, drawing, platform, Inspector and viewport neighbour
specs then passed five repeats at the same six-worker/eight-CPU allocation:
1,195 passed, zero failed, zero flaky and zero skipped, report
`tests/.output/g/rWbulat`.

These observations do not establish a cause or identical pre-existing failures.
The complete Build and Dev results are reported separately with the final commit.

## Follow-up

Investigate initial ResizeObserver measurement and frame delivery when a native
capture browser shares load with the 1,500-node Checks fixture. Retain the existing
visibility, camera, viewport and keyboard assertions and their timeouts. Do not
add retries or replace readiness with fixed waits.
