## Dialog handoff focus review

The replacement dialog takes keyboard focus after the outgoing dialog restores its opener. Escape
then returns to that original control, matching the Share handoff contract without adding chrome.
Direct and controller-based focus restoration are covered with and without StrictMode. Capturing
during render was rejected because it retains a control removed with the outgoing dialog; capturing
on every effect setup was rejected because StrictMode replay would replace the original opener.

The regression was mutation-checked against the previous hook: all four replacement cases failed
at the final focus assertion, while the existing close tests passed.
