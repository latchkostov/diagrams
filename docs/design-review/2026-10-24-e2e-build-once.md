## CI E2E infrastructure review

This changes build and test orchestration only. The editor, controls, keyboard
behavior, layout and exported artifacts keep their current behavior; the chrome
budget is unaffected. Six stable shard check names and the existing failure-report
artifacts preserve the contributor workflow. Missing shared builds fail explicitly
instead of silently rebuilding, and the run comparison includes queue/build time
so contributors can assess the actual wait for a green check.
