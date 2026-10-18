## Self-host server review fixes

Reviewed against the UX principles: no editor controls, text, layout or interaction changes. Deep links
now resolve their scripts and styles at the configured mount, and directory links retain their relative
resources. The editor keeps its stricter framing policy when unrelated URL text resembles an embed
parameter. Compression load shedding preserves usable responses without adding operator controls.
