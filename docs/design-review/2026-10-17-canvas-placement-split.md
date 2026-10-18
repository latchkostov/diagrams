## Canvas placement split review

No controls or chrome are added. Naming still opens the same inspector fields; quick-add, connection drops, Alt-drag copies, insertion previews, smart guides, boundary membership and rail drops keep their existing behavior. The CanvasInner JSX is identical, including DOM, ARIA, classes, test ids and inline handlers.

The extracted hooks remain at their original call sites. A source audit expands all 194 CanvasInner hook calls and compares every argument, callback body and dependency array. Viewport changes still use the existing camera events; placement keeps its original frames and timers. Existing interaction tests remain unchanged.
