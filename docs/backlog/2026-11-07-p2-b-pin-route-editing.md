## T05.02: shaping a connection to an off-screen pin needs a decision

Focus and Follow replace hidden endpoints with temporary pins. Their detours are presentation geometry;
freezing those points as saved waypoints would persist a frame-specific route and lose the hidden tail.

Decide whether shaping waits until both endpoints are visible, or whether a drag reconstructs and preserves
the complete hidden tail. Until decided, clipped connections retain their existing natural editing geometry.
Complete, visible connections use the displayed lane for both pointer and keyboard shaping. Pin strokes,
halos and hit targets agree, and capture restores every path and the shared route model.

The owner was asked during P2-B. No new pin-shaping behavior is introduced without that decision.
