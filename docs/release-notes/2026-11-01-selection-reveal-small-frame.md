## Keep fitting selections visible in short Focus and Follow frames

Selection reveal now relaxes its preferred breathing room when a card fits the
exposed clipping frame but cannot fit those margins. The complete card, including
its decoration space, stays inside the frame at the existing zoom. Selections
larger than the safe frame retain their centring fallback.

Regression coverage includes a 200 px exposed frame and overlapping floating
controls above a bottom dock, with complete frame containment and a stable second
reveal. No output goldens change or are re-recorded.
