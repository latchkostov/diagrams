## Tutorial download failure injection

Round-six Nightly 41300989083 fails the Linux Dev recovery case at tutorials.spec.ts:1306.
The route also matches `retry-storm.json?import&raw`, a static reference imported by the tutorial
catalog. Aborting that request fails the outer lazy tutorial chunk, which correctly offers a toast
Retry while the inner start loader never mounts.

The injection now lets raw reference imports through and fails only the example document's load.
The existing loading, missing Start, inline Retry, successful retry and rendered-node assertions
are retained. Windows Dev reproduces the original failure once and passes all three executions
with the corrected interception. No product loader, timeout or recovery assertion changes.
Temporarily removing the raw-import guard reproduces the missing inline Retry again.

Linux container and branch Nightly evidence is recorded in the round-seven verification fragment.
