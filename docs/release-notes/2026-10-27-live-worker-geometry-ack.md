## Live labels wait for current geometry

Live's worker renderer now posts a frame after card detail geometry changes even when playback
is paused and the snapshot is unchanged. Labels stay hidden through older acknowledgments and
worker repaints, then return when the current geometry's frame is acknowledged. Geometry and
style caching remain in place; unchanged frames still skip worker messages.

The regression tests now use real DOM mutation records for wrapped and expanded cards, preserving
the stale-label assertions and covering successive geometry changes during a frame in flight.
No output goldens are changed.
