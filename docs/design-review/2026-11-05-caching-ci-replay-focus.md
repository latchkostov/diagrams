## Caching CI recovery review

The cache repair still selects the first rule serving the exercise request, preserves learner edits
and repairs saved overrides or the current draft. Reusing compilation adds no controls or new state
for learners to manage. Address and predicate edits invalidate the reused values.

The palette's keyboard ownership now follows actual focus rather than a focus attempt. A blocked
handoff retains the full query and an early Enter; retry stops when focus arrives or the palette
unmounts. Existing command ranking, shortcuts, focus restoration and chrome are unchanged. The
blocked-focus regression covers Enter both before and after the search receives focus.

Increasing a timeout, weakening the sweep or changing the request-wait assertion was rejected:
those changes would leave the underlying input handoff and redundant compilation in place.
