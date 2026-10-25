## Loading details retain focus after keyboard re-entry

When details are still downloading, Enter → Shift+Tab → Tab now returns ownership to
the loading stop. The finished pinned card receives focus, so keyboard reading can
continue. Staying on the node after Shift+Tab still leaves focus on that node.

The focus machine documents every transition and tests every state/event payload
combination. No parity goldens changed or were re-recorded. This fix round runs only
the requested unit and browser specs; full parity remains for CI.
