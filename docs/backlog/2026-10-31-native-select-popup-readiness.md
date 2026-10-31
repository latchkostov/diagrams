## Observe the popup before sending its navigation keys

Nightly 41183332686 still fails the three macOS metric-picker locale cases with the original value, despite explicit Space and Enter. The initial repair opened and committed the popup but continued using `Locator.press` for each key, which focuses the DOM owner again. The exact expected values and translated labels remain correct; no assertion is removed.

The harness now requires the select to have focus, opens it with the page keyboard, waits for the native `:open` signal, then sends navigation, Enter and Tab through the page keyboard. It does not refocus the DOM element between popup keys. The unchanged Speed test still checks uncancelled navigation-key defaults and requires 8×; the three metric tests still require threads waiting and their actual translated text.

Native Windows passes all four cases twice (**8 passed**), including the new explicit popup-open assertion. The two-repeat Linux result and macOS before/after rate are reported in the PR. This remains subject to native macOS verification: an unautomatable operating-system popup must be reported for a product/testing decision, never silently replaced with programmatic selection or quarantined.

Reference: [Playwright documents that Locator.press focuses the matching element](https://playwright.dev/docs/api/class-locator#locator-press). The macOS failure trace motivates avoiding that extra operation; its causal effect must agree with the final native result.
