## Black Friday's Dev-server deadlines after caching

`tests/e2e/lowzoom-chips.spec.ts:256` (25% then 100%) loads Black Friday in two pages, zooms both to 25% and captures both SVGs, all inside the unchanged 30-second deadline on the Dev server. It already ran at 24–28 s in Nightly before caching (`41578118092`); it now takes 23–32 s and fails one of three Build ×3 repeats.

What got slower is not the capture. In the Linux container (Dev server, one worker, two CPUs), the export itself, its DOM (1,454 elements at 100%, 1,014 at 25%) and its output (9,460,272 bytes) are unchanged from `11839fab2`; a single page's first 25% capture takes 0.86–1.03 s on both, and the same parallel captures match once the pages' background work has finished (1.14–1.42 s against 1.05–1.33 s). No additional lazy chunk loads during the capture, and the stylesheet and custom-property counts are unchanged.

The difference is the Checks worker's scenario sizing, which starts about 0.2 s after each page loads and overlaps both pages' zoom and first capture:

|                                                                              | `11839fab2`               | `9fe20e3aa`                   |
| ---------------------------------------------------------------------------- | ------------------------- | ----------------------------- |
| `planScaling` for Black Friday (Node)                                        | 357 ms, 3 simulations     | 914 ms, 4 simulations         |
| Simulated messages (doors-open / poison-deploy / partner-quota / doorbuster) | 2,705 / 2,713 / 2,067 / – | 4,920 / 6,859 / 6,112 / 7,327 |
| Checks worker, post to reply after load (browser)                            | 0.60–0.74 s               | 1.37–1.72 s                   |
| First parallel 25% capture per page                                          | 1.11–1.33 s               | 1.69–2.08 s                   |

The engine's cost per simulated message is unchanged (53–56 µs). The example's new callers, timeouts and fourth simulation run the call model: `beginCall`, the credit ledger and thread reservations account for most of the added time. On a four-CPU runner with three test workers, the two pages' sizing runs land inside the capture.

No product change is retained for this test. Options that keep the deadline and outputs:

- speed up the engine's call and ledger path (an engine change: needs the fc-sweep gate);
- schedule the first Checks run so scenario sizing does not start while the page is being used (changes when findings appear);
- reduce the example's simulated traffic (changes its goldens).

The Follow-camera deadline (`keep-camera.spec.ts:264`) had the same source plus per-frame Live work; its Live part is addressed in `docs/release-notes/2026-11-04-nightly-linux-live-pills.md`.
