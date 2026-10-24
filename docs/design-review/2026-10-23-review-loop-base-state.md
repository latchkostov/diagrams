## Review workflow consistency

Checked the CLI preparation and continuation flow against the UX principles. Missing PR base
commits recover automatically through a targeted fetch; a failed fetch identifies the commit and
explains how to retry. Separate branch and PR state identities keep round limits predictable.
README continuation commands preserve PR identity, with branch-only alternatives explicitly labelled.
No application controls, canvas interactions or visual output change.
