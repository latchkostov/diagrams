## Live controls precede the deferred event timeline

The latest master Nightly fails the initial roving-tab assertion in both Windows and Linux Dev. The Linux trace shows Live controls at navigation readiness but no timeline; the failure snapshot already has all five markers. The timeline is a separate lazy surface, so controls are not its mount signal.

The keyboard setup now waits for the first event marker before the unchanged exact one-tab-stop, navigation, focus, pointer and simulation-time assertions. A held Timeline chunk makes the original setup finish with zero mounted markers: **1 failed** on native Windows. The repaired setup stays pending until release and retains the exact tab count. Temporarily removing the wait reproduces the failure again. Both affected cases then pass twice: **4 passed**, Node 24.22.0, native Windows Chromium, three workers constrained to four CPUs.

The generic Live navigation helper remains unchanged: other lazy-surface tests intentionally exercise the controls while the timeline is downloading. No application behavior, timeout, tolerance, keyboard oracle or golden changes are introduced. The complete spec's Linux two-repeat result is recorded in the final verification fragment.
