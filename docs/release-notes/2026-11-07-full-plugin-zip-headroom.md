## Full plugin download headroom

The full plugin's read-only viewer now imports the shared planning readout stylesheet directly,
leaving the unreachable inspector layout out of the download. Drawing, planning readouts and playback
keep their behavior. The generated folder, fresh site download and ZIP use the same viewer.

The ZIP shrinks from 829,045 to 826,641 bytes, saving 2,404 compressed bytes. That leaves 8,359 bytes
under the unchanged 835,000-byte cap, including 2,215 bytes beyond its required 6,144-byte headroom.
No parity goldens change.
