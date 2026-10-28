## Faster first render in translated languages

Only the core translation catalog loads before the app renders. Tutorials, stencil descriptions,
simulation/planning settings, export dialogs and AI wait for their own strings through the existing
lazy surfaces. Slow or failed downloads keep translated loading/Retry UI, while editing and exports
keep their existing focus and readiness behavior. Stencil names stay available on the first canvas.

Production startup locale payloads, measured with gzip level 9 on the same branch base and final build:

| Language |   Before | Core after | Reduction |
| -------- | -------: | ---------: | --------: |
| German   | 82,716 B |   31,217 B |     62.3% |
| Arabic   | 91,674 B |   37,299 B |     59.3% |
| Russian  | 94,260 B |   37,087 B |     60.7% |

These are catalog transfer bytes, excluding the shared app/runtime code. The largest core is Arabic,
37,299 B, under a new 38,000 B gate. Complete split-language transfers remain under the unchanged
97,500 B budget (largest: Greek, 92,599 B). Canvas and Live reserves are unchanged.

No output goldens are intentionally changed or re-recorded: diagram, export, tutorial and translated
message output is preserved. The skill viewer is regenerated with the same complete standalone strings.
