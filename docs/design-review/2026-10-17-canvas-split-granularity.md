## Canvas split granularity review

This move adds no controls or chrome. The title, checks, start card, hints, keyboard navigation and panning retain their existing DOM, ARIA, classes and test ids. Hooks still execute at their original CanvasView call sites. The existing camera controller remains the only viewport writer.
