## Production counter restoration

The change restores two diagnostic canvas attributes at their existing sampling cadence. It adds
no controls, visible text, focus changes or loading boundaries. The worker, rendering, low-zoom
behavior and exports keep their existing paths. Production still omits pixel-readback and
benchmark hooks; the sub-path test explicitly checks the pixel hook stays absent.
