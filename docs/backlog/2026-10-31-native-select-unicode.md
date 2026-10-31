## Unicode native-select typeahead

The first round-three Nightly selected the exact requested metric in English and the pseudo-locale on macOS, but Arabic remained on threadsBusy. Isolating the browser control reproduced it on Windows too: Playwright's keyboard.type inserts non-US text instead of issuing the printable character events native typeahead consumes.

The macOS driver now sends trusted printable character events through Chromium, using the shortest unique label prefix. Windows/Linux retain their arrow and popup paths. Explicit typeahead regressions exercise English, Arabic, and the real resetting Add step control; they assert exact values and exactly one added Note. No application values are assigned by the driver. The native-select diagnostic remains unchanged.
