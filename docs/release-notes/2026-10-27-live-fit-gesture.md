## Live fits finish without an accidental connection gesture

Live, phone Live and Present now gate node dragging and connecting on Edit mode.
The failing CI trace showed a card moving between click targeting and delivery:
the click reached its bottom dot, started click-to-connect and held pane work in
`deferred`. This was an editing gesture hold, not an unfinished identity settle.
Diagram and shape handles now respect their editing permission too.

A desktop/phone regression invokes Fit programmatically, delivers that dot click,
opens Properties and requires both camera and interaction readiness to return to
idle. Reverting the runtime fix makes both widths fail with `deferred` again.
Held-zoom identity checks now measure painted text using the actual viewport
scale and exercise long names through a zoom reversal. No budgets or timeouts were
changed. No parity golden was edited; rendered exports are intended to stay identical.
