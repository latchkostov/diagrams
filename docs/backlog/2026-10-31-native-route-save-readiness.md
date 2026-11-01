## Independent completion signals

Baseline Nightly 41253920016 fails Linux Dev's first segment drag with Expected saved bends. The rendered custom route and completed history transaction do not acknowledge the independently debounced document save. The route reader now uses the existing current-document save acknowledgement before inspecting persisted bends.

A regression makes two real drops, retaining the first saved bends while holding the second save's actual debounce callback. It advances the fake history clock until the real commit completes, observes the reader's first document/storage access, then releases the save. Temporarily restoring the storage-only reader fails the exact changed-bends assertion: it returns the previous drop. Restored, the regression passes on Windows; the complete edge-shaping spec passes 48 Linux executions across two repetitions, zero failed/flaky.

The initial regression's fixed frame advance did not finish history on every run; it now drives the fake clock to history's actual acknowledgement. The held 300 ms callback is the product's existing autosave debounce, not a new delay or assertion budget. All geometry, snapping, Undo/Redo and saved-bend assertions remain. No application, timeout, tolerance, skip, quarantine or golden changes.
