## Capture suites replaced native launch repairs

The four capture-enabled suites (live-record-capture, lazy-recording, csp and viewer-bundle) supplied their own launchOptions.args. Playwright replaces this option rather than appending it, so these browsers lost the shared loopback resolver, Windows port-randomization repair, and the new macOS host-candidate setting. This is a separate harness defect from recording readiness or codec behavior.

They now extend a shared capture fixture, retaining every inherited launch option and adding only the existing tab-capture acceptance flag. A real-browser regression reads Browser.getBrowserCommandLine through CDP and requires both the ordinary native arguments and the capture flag. Original override: **1 failed** on Windows because the native arguments are absent. No codec, recording, worker, timeout, tolerance, server or application configuration changes are made.

The earlier combined Windows probe that overlapped a Linux rebuild is invalid: its five joining failures have 404s for the replaced production chunks. Once serialized after the Linux gate, both complete native specs pass **18/18** across two repetitions, including all eight recording executions. Those passes are reproduction evidence, not proof that the launch override caused every historical recording failure. The new command-line regression directly proves the option-loss defect; final native and Linux results are recorded in the verification fragment and PR.

Application output remains unchanged. No golden is re-recorded and no test is skipped or quarantined.
