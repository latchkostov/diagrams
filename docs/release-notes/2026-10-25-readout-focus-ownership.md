## Keep keyboard focus through Live detail transitions

Activating a section in an unpinned Live summary keeps focus in the pinned card when
its section buttons are replaced. Returning from a loading detail stop to its node with
Shift+Tab now keeps focus on that node when the details finish downloading.

Focus ownership uses explicit unclaimed, held, cancelled and transferred states. Existing
menu and current-readout guards remain. No parity goldens were changed.
