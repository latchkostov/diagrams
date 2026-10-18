## Unreproduced browser download completion stalls

The first full Linux gate for latency commit `37065b76c297d87659001d678f9fdd413a6ed049`
timed out in the two `image-slices.spec.ts` capability cases without OffscreenCanvas and without
Worker or OffscreenCanvas. It used four workers, four CPUs and 12 GB RAM. The traces show the
app's success toast, one download and the expected filename; `download.failure()` then waits
until the test's hang backstop closes the context. The PNG/SVG content assertions are not reached
for the stalled artifact. No export implementation or timeout was changed for this feature.

A clean checkout of `origin/master` at `9cdb890ec0302b374ba12cc7fe9c83915b03275c` passed all
28 targeted image-slices cases with the same resource settings. Its full Linux gate also passed
all three capability cases at the image-group checkpoint. These observations do not establish
a pre-existing failure or justify waiving a failed feature gate.

If this recurs, capture Chromium's download progress and artifact state alongside the app's
completion signal to distinguish browser transfer, filesystem completion and cancellation.
Preserve the download-failure, PNG-signature and SVG-root assertions and the existing hang
backstop. Reproduce the stall before changing export behavior or test infrastructure.
