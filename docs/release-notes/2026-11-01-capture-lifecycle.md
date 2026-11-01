## Image capture and late canvas surfaces

Continuing the export tutorial can mount a low-zoom canvas surface while an image is being captured.
That surface now joins the capture through React's normal effect commit. The capture entry point
commits already mounted surfaces synchronously before measuring the natural drawing, without
calling `flushSync` from a mounting effect.

Export content and geometry are unchanged. No parity golden is intentionally changed.
