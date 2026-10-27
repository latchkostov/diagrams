## Readable node identity at every zoom

Designer review: delivery-dispatch at 35% in 1280×800 and black-friday-commerce
at its 24% Overview fit in 1440×900, in light and dark themes.

Individual cards retain their icons and measured, truncated titles. Overview keeps
the zone bands, tints and contrasting outlines without replacing services with counts.
Titles stay within their card widths and clear neighbouring cards; secondary text keeps
its existing detail rules. No controls or chrome were added.

The review caught two gaps, both resolved: Icon-style nodes now use the same icon sizing
and title-fitting path, with captions constrained to their width; a full zone's outside
header checks neighbouring cards for collisions. The browser regressions additionally
cover Compact and Icon styles. Review passes.

Rejected: anonymous service-count aggregation and hiding node identity below a zoom
threshold, because either removes the information needed to recognize the system.
