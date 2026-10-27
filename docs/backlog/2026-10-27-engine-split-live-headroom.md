## Live bundle headroom after the engine resource and broker split

Owner: latchkostov, in a dedicated Live bundle trim PR.

The resource/broker split measures the additional LiveSession download, including its static imports
beyond the loaded canvas, at 134,996 / 135,000 B gzip. That leaves 4 B, below the unchanged 8,192 B
warning floor. Its merge-base measures 134,965 B, so this split adds 31 B and meets its +200 B target.
The existing execution adapter's positional wiring keeps the move within that fixed budget.

Continue the [existing Live bundle trim follow-up](2026-10-25-live-session-headroom.md). Recover
headroom in a dedicated change, preserve startup boundaries and output parity, and keep the fixed
budget. Do not fold an unrelated feature trim into this mechanical engine extraction.
