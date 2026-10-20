## Follow-ups 14: review corrections

No editor controls or settings were added. Connections still meet the visible outline; only the hidden routing escape point changes. Rectangular endpoints retain their existing stubs. Pinched and open outlines keep opposite handles separately hittable without moving either target off its stroke, verified by starting a connection from each side.

Shift makes a rectangular annotation square during a corner resize in both editor and Lab. Releasing it during the same gesture restores the opposite corner instead of leaving the shape displaced. The Lab retains React Flow's Shift selection behavior before a gesture; its regression presses the modifier during the resize. A focused Lab fixture exposes the same annotation component and shared adapter as the editor.

Rejected blanket increases to exit stubs: they would move already valid rectangular routes. Also removed explicit mount and size invalidations rather than adding another measurement path alongside ResizeObserver. Operation counts cover one forced batch per canvas frame at 1, 100 and 1,000 invalidations; browser regressions cover mount/paste measurements, independent handle targets and resize behavior. No review finding was rejected.
