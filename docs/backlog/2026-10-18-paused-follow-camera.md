## Resolved: paused follow camera during Inspector resize

Policy row W1b now stops the follow transition at `pane.changed`, before the two
measurement frames can advance it. The original exact-transform E2E assertion is
unchanged. Scheduled and running transition regressions fail without the policy fix.
See the [release note](../release-notes/2026-10-18-paused-follow-camera.md) for the
reproduction, fix and verification. The duplicate resize backlog entry is removed.
