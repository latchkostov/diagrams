## Native browser verification

Native Nightly now retains every discovered test identity when a deadline interrupts a shard, reporting unfinished tests separately from failures and existing skips. Live tutorial, timeline, inspector and verified-fix checks wait for their actual readiness signals. Tab-capture suites preserve the shared native Chromium launch configuration.

Verification observers also preserve worker transfer lists, so observing a checks request cannot accidentally force canvas rendering onto the main thread.

Accessibility scans wait for the real view entrance to finish before measuring contrast. Real settled violations still fail the scan; unrelated perpetual animations do not block it.

Bend-carry fixtures also wait for the fit controller before reading drag coordinates, so a briefly stable animation frame cannot place the pointer beneath the editor rail.

macOS peer tests also compare mDNS and direct host candidates in a server-free diagnostic; this is test-runner evidence, not a change to the application's network services. The original peer admission assertions remain enabled. An isolated select diagnostic records the native popup input boundary; unsuccessful popup-key experiments are removed. The select-driver decision, Control-drag/context-menu conflict and remaining native failures are explicitly tracked for the orchestrator in the PR and dated backlog fragments.

## Output parity

All **3,178 committed goldens are unchanged**: no changed, added, missing or stale golden. These changes affect verification and reporting only. No simulation, planning, stencil, export or saved-diagram behavior changes, so no new showcase example or golden recording is needed.
