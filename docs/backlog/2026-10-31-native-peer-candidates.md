## macOS peer admission: host candidate experiment

All 31 peer/admission failures persist across [41167179188](https://github.com/latchkostov/diagrams/actions/runs/41167179188) and the newer master [41168472337](https://github.com/latchkostov/diagrams/actions/runs/41168472337). The traces stop before admission: the tracker is reachable, the host reaches no-answer and neither side has a connected transport peer. This does not establish an admission-protocol defect.

The working hypothesis is mDNS host-candidate resolution on headless macOS. The [WebRTC standards issue](https://github.com/w3c/webrtc-pc/issues/3109) records macOS Local Network permission interacting with mDNS candidates. The native test browser now uses direct host candidates on macOS, preserving every existing pinned Chromium feature switch. Windows retains its existing port-randomization repair; Linux keeps its ordinary flags. No application, tracker, TURN, server or ICE configuration is changed.

To verify the mechanism, shard 1 on each native OS records a same-run comparison after the unchanged browser gate: two isolated contexts, no signaling service, no STUN, real SDP exchange and a real data-channel message. The artifact includes mDNS and direct-candidate outcomes, ICE/connection state journals, candidates and candidate-pair stats. It writes each mode synchronously, closes each browser, and is included in the existing native report upload even if the gate fails. These are diagnostic observations, separate from test pass/fail counts. The original peer/admission assertions still run unchanged in every shard.

Windows delivers the probe message in both modes. Unit regressions fail against the original launch helper (**2 failed, 3 passed**) and require the macOS feature addition, opt-out comparison, unchanged Linux flags and preservation of Windows's existing flags.

Native macOS confirmation: run 41182626886 shard 1 records mDNS **delivered=false**, both peers new/new with `.local` candidates; direct **delivered=true**, both connected/connected with private host candidates. Completed branch run 41183332686 reports **zero peer/admission failures**, including the 31 persistent cases above. This establishes the harness repair without changing the product or admission assertions. The final SHA's dispatch is linked in PR #403.

## Product decision for the orchestrator

The application cannot grant macOS Local Network permission for its browser. If the same-run evidence confirms this boundary, decide whether room connection help should explicitly direct Mac users to that OS setting when local peers cannot connect. Do not request camera/microphone permission as a workaround, change network services, or quarantine the native assertions. This branch changes only the automated browser's host-candidate discovery.
