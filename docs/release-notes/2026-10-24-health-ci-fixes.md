## Current-health CI regressions (#287)

Retry-storm introductions remain visible at 1.2 seconds but no longer pause playback. The
arrival schedule, outcome bands and early storm detection are restored without changing the
engine, detector thresholds or outcome assertions. A regression compares narrated and silent
playback snapshots directly.

Current-loss badges keep their ten-second attention window. The badge Lab now includes an
intake that actually loses messages; retained dead letters are not treated as current losses.
The contrast test checks that intake's alert with the same AA threshold in both themes.

Outcomes keeps one keyboard-readable loss summary since restart. When that summary already
explains losses and failed attempts, separate Lost and Failed rows no longer repeat them.
The ownership test now checks the cumulative count in Outcomes instead of comparing it with
the current-window badge, and rejects duplicate total rows in all three tested locales.

Eight retry-storm goldens intentionally remove the four introductory pause flags: agent
describe, agent edit, native export, draw.io XML, draw.io metadata, light HTML, dark HTML and
skill script output. Serialized sizes, hashes and compressed metadata follow those removals.
Simulation outcome goldens are unchanged; the harness already resumes narration pauses.
