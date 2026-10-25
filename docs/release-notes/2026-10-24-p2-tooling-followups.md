## Development tooling follow-ups

Lazy surfaces survive hot module replacement without duplicate-registration errors. Replacements belong to their defining module; mounted old consumers still participate in export readiness until they unmount, and genuine duplicate IDs still fail.

Development skill ZIP downloads compress in a worker so Vite can keep serving requests. The worker uses the unchanged deterministic production encoder, with byte-for-byte equality checked on the same payload. A download regression extracts the viewer after a source edit, including when an older ZIP is still pending. The 835,000-byte cap is unchanged.

The complete waits-review sampling suite now runs in the serial heavy project, without unit coverage/probe overhead. Its generated coverage and assertions are unchanged, including the twentyfold Nightly multiplier.

Skill-output parity: 74 goldens unchanged; no goldens were updated. The targeted browser contracts passed 55 cases with zero failures or flaky results and one existing narration-SVG fixme. The waits-review suite passed all 37 cases at multiplier 20. Production viewer and ZIP bytes match the original implementation (833,056-byte ZIP).
