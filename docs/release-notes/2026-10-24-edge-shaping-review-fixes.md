## Edge shaping review fixes

Automatic Bezier and Straight lines keep their reconnect controls without exposing orthogonal segment
handles. Each segment drop has its own undo step, even for consecutive drags. Space+drag over a segment
handle pans the canvas without changing the line. New jogs preserve the 24 px port stubs, including
short gaps and end segments; inset shape ports keep enough room to escape their node's box.

Selection checks are shared across selected edges. Regression tests also distinguish SVG from HTML
export elements and compare free modifier drags with grid-snapped drags. No parity goldens changed.
