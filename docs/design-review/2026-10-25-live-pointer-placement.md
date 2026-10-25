## Live pointer and placement UX review

The batch adds no toolbar or inspector controls and consumes no chrome budget. Readout content,
placement rules, countdown rounding and warm keyboard traversal remain the same. Protected
controls remain actionable after resizing, appearing or disappearing. Pointer corridors only
serve unpinned readable cards.

The cold loading shell supplies the existing readout stop, with an accessible loading label.
Tab and Enter transfer to the finished card through the interaction focus policy; moving on,
a menu or Escape retires that request. Pinned loading stops also let Tab reach the next node.
Existing hover-card browser tests cover layout, localization, presentation, embeds, scrolling,
anchor movement, and forward/backward keyboard navigation.

Rejected unconditional completion focus because it steals focus from later actions. Rejected
observing descendant styles because the timeline updates them without changing an obstacle.
Kept countdown buckets at the display boundary because current callers pass snapshots as
props; adding another Live store subscription would duplicate those existing subscriptions.
