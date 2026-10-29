## Bulk geometry preparation

Reviewed the readiness, frame decoration and identity changes against the UX principles. This is
preparation work behind the existing Auto-layout, Paste and Fit view actions. It adds no controls,
settings, terminology or chrome. The full diagram DOM, accessible names, selection, document history
and export capture lifecycle remain in place.

## Completion and readable geometry

The performance gain must preserve the moment at which a drawing is usable: delayed entrances,
delivered measurements, reveal, final routes, camera completion, captions and labels still belong to
the readiness boundary. Keeping live size checks in readiness protects against a delayed
ResizeObserver. Frame and identity caches must invalidate for changed ink, wrapping, font metrics,
variants and scale; image capture must clear them before returning to presentation detail.

The review identified two animation-cache cases requiring explicit coverage. Removing the attribute,
class or test id that made an element an overlay must invalidate its previously indexed membership,
otherwise a paused animation can hold the next fit indefinitely. A new Web Animations API animation
can start without a DOM mutation, so the confirming readiness sample must refresh discovery on the
current overlays before accepting stability. Discovery may stay cached while measurements are held;
a newly discovered pending entrance must reset stability and wait for its completion.

## Scoped fit reuse and region titles

A scoped pane/chrome borrowing prototype was reviewed, then rejected because the local samples did
not establish a meaningful action-level benefit. Camera geometry continues to read the actual pane
and overlays; no borrowed geometry crosses a React commit or async boundary.

The region-title extraction retains its placement order and batches chip size reads before transform
writes. Ignoring the decoration's own chip portal mutations avoids a redundant scene pass; chip text
and size changes still need the title layer's own update path. The review identified an inherited
scale case for the new metric cache: the exact identity scale can settle after a wheel gesture while
the camera transform already has its final zoom. Annotation zone label dimensions and offsets must
therefore invalidate when `--rf-zoom-exact` changes at the same transform. Likewise a chip's
ResizeObserver must not retain a size measured under different inherited low-zoom styling merely
because its words and class name stayed the same.

## Review boundary

No simplification of the user interface is needed. The existing actions and visual result should stay
the same while preparation finishes sooner. Acceptance depends on regression coverage for the
animation and inherited-scale cases above, unchanged output parity, and the prescribed layout,
annotation, inspector, camera, identity and low-zoom browser checks. This review inspected source and
lifecycle contracts; it does not claim a completed browser walkthrough or substitute for those results.
