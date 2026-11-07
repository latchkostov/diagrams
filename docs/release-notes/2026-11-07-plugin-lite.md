## Script-free directory plugin and layout on open

The Claude directory plugin (`livediagrams`, at `skills/livediagrams`) now returns editable diagram files
without executable code. It shares generated knowledge with the full plugin, now `livediagrams-full`
at `skills/livediagrams-full`. Our marketplace recommends the full plugin; the ZIP keeps the full payload.

Open a diagram without numeric node positions from a file, paste or share link and the app lays it out
with the existing layout engine, then quietly reports it. Positioned files follow the existing load path,
including their fixed connection sides and waypoints. No controls were added.

Output parity goldens are expected to remain unchanged: full layout, validation and export behavior stay the same.
