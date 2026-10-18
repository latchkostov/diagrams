## Collaboration E6 follow-ups (Nightly network smoke)

- **Remove the smoke's CSP bypass in E7.** The production CSP blocks the trackers until E7 adds them to
  `connect-src`. The smoke's pages use `bypassCSP: true` until then, so E7 should drop the bypass and let the smoke
  check the real policy.
- **Two runners and a control job (plan §4.2) are not done.** Both browsers run on one GitHub runner, so the
  connection is usually host to host. That checks the trackers and the app over the public network, but not NAT
  traversal between two networks. The plan's next steps are:
  - a two-runner matrix, meeting through the trackers with a shared room link passed as a job output;
  - a control job that only checks the trackers answer.

  Add them if the single-runner nights turn out not to say enough.

- **Which nights the trend counts.** The trend reads earlier scheduled runs' `nightly-collab-smoke` artifacts. A
  smoke that didn't get as far as its result still uploads a failed one (a broken smoke should alert too). A run with
  no artifact at all (from before the smoke existed, or cancelled before the upload) is left out, not counted as
  passed or failed.
- **The recording check sets the recorder's mark by hand.** The e2e sets `data-lv-recording` on the canvas area (the
  recorder's target) instead of recording, because a real take needs Live mode and tab capture. No spec checks
  that a real take sets and clears the mark; a recording spec in a room would.
