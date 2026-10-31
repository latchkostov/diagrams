## Consecutive picker choices share a native search prefix

Nightly 41245495563, macOS shard 11, leaves resource-headroom's Simulations picker on Free play when the keyboard recipe immediately asks for Image burst again. The trace sends consecutive typeahead choices to the same focused select.

An isolated pinned Windows Chromium probe reproduces the platform-independent Blink behavior: B selects Beta, immediate C leaves Beta selected, and a keyboard blur/re-entry lets C select Charlie. Chromium's [select implementation](https://chromium.googlesource.com/chromium/src.git/+/refs/heads/main/third_party/blink/renderer/core/html/forms/html_select_element.cc) resets its typeahead session on blur.

For consecutive typeahead choices on the same control, the driver now sends Tab and Shift+Tab before the next printable prefix, requiring focus to return to the select. Windows/Linux's ordinary arrow/popup path is unchanged. The exact native values and resetting action-select assertions remain.

The real-browser regression forces the adopted typeahead path on every OS and makes two immediate choices. Original helper: expected Charlie, received Beta. No value assignment, synthetic selection, sleep, timeout, tolerance, budget, skip or golden change. Final targeted and native-run results are recorded in the round-four verification fragment.
