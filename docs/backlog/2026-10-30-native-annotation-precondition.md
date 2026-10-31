## macOS annotation fixture precondition

Native macOS shard 5 in branch Nightly 41164001976 (source a9033e10b4d73f38565df42717cd3a15e2b87988) fails round4-polish:259 before the selection behavior is exercised: the note's right edge is 665px where the existing precondition requires greater than 780px. The preceding run 41160253180 has the same observation.

Two Windows probes, each repeated twice, still pass after waiting for camera idle, including a wait placed after the note becomes visible and the inspector is collapsed. Those diagnostic edits were restored. A camera wait alone is not a demonstrated fix.

Proposed investigation: capture the settled viewport transform, pane box and annotation box together on macOS. Establish the intended right-edge pose after the import camera has finished if the opening fit correctly places the note elsewhere. Preserve both the exact precondition and the subsequent inspector-containment assertions. This remains unresolved and is not attributed to the pinch test fix.
