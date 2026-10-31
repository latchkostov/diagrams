## Scan the settled view, preserving contrast assertions

macOS shard 10 in Nightly 41183332686 fails the syllabus scan with many text nodes at foreground `#7d828d` on `#f6f7f9` (3.59 contrast), while the light theme's actual text token is `#5f6673`. The view's `view-in` opacity animation in `src/styles/app-shared.css` composites that settled text against the board during entrance. The shared accessibility helper previously started Axe as soon as the content assertions passed, while that animation could still be active.

The harness now awaits the actual `view-in` CSS animation's `finished` promise before scanning. A cancelled entrance is also settled; unrelated perpetual animations do not delay the scan. It neither disables animation nor changes theme colours, Axe tags, scope, violations, assertions, deadlines or tolerances.

Four native Windows Node units cover a held entrance, cancellation, unrelated perpetual animations and a real violation still failing the scan. Temporarily removing only the helper's wait makes the held-entrance regression fail: Axe is called before release. Restored: **4 passed**. The requested two-repeat Linux syllabus gate returned busy (75), not a test result; the live resource holder was left alone. Final native branch dispatch and its exact per-OS results are linked in PR #403. No claim of a macOS repair is made before that runner finishes.
