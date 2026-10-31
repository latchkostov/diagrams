## Observe the popup before sending its navigation keys

Nightly 41183332686 still fails the three macOS metric-picker locale cases with the original value, despite explicit Space and Enter. The initial repair opened and committed the popup but continued using `Locator.press` for each key, which focuses the DOM owner again. The exact expected values and translated labels remain correct; no assertion is removed.

The follow-up experiment required focus and `:open`, then sent navigation through the page keyboard without refocusing the owner. This was not evidence that CDP could operate Cocoa's menu loop. The experiment is now removed and both original specs restored, with every keyboard and exact-value assertion enabled.

Windows and Linux each passed eight executions with the experiment. Those results do not establish macOS support. See `2026-10-31-native-select-platform-decision.md` for the primary Chromium explanation and isolated native diagnostic.

Reference: [Playwright documents that Locator.press focuses the matching element](https://playwright.dev/docs/api/class-locator#locator-press). The macOS failure trace motivates avoiding that extra operation; its causal effect must agree with the final native result.
