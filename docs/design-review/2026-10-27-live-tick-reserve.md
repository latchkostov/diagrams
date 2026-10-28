## Live reserve review

This refactor keeps the existing Live controls and presentation behavior. Dirty groups
preserve shared styles without timer-driven geometry reads. The worker's current-geometry
acknowledgement still gates trace labels, including paused runs and superseded frames.
No new chrome, focus rules, UI text or example scenarios are needed.
