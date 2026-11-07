## Cold-cache connection-share fix

Reviewed the corrected demand and replica recommendation against the Checks behavior contract.
The existing finding and undoable fix now reflect the origin connection's configured share.
No controls, wording, layout or interaction changes are needed. CDN routing retains its existing
weighted target semantics; ordinary forwarding and origin projection share one helper.
