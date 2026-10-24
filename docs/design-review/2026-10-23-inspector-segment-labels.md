## Inspector segment labels: visual review (#265)

The approved Request mock shows the full While waiting choices. Reducing segment padding from 8 to 6 px and type from 12 to 11 px restores that result without changing the sheet width or the wording. The track explicitly stretches across the value column. Natural wrapping replaces ellipsis when translated text needs more room; the six viewport/language combinations require at most two lines. The radio group semantics and keyboard interaction remain covered by the existing tests.

Reviewed all nine Inspector segmented controls at 1280 and 1440 px in English, pseudo-English and Arabic, including the planning controls for busy-thread units and traffic-mix mode. The busy-thread unit selector retains its compact place beside its numeric input. No controls or chrome were added. Rejected shortened copy and clipped labels because they conceal the distinction between holding and freeing a thread. No assertions were loosened.

Re-shot the public retry-storm example in the production E2E bundle, with full-height companions, plus the dark and 300 px Service sheet. The captures are in [inspector-segments](inspector-segments/); filenames identify width and language when they differ from the default 1440 px English view.

- [Request, 1440 px English](inspector-segments/impl-H-request-sim.png)
- [Request, 1280 px pseudo-English](inspector-segments/impl-H-request-sim-1280-en-xa.png)
- [Request, 1440 px Arabic](inspector-segments/impl-H-request-sim-1440-ar.png)
- [Service, 1440 px English](inspector-segments/impl-H-service-sim.png)
- [Service, dark](inspector-segments/impl-H-service-sim-dark.png)
- [Service, 300 px sheet](inspector-segments/impl-H-service-sim-narrow.png)

The native Inspector layout suite passes all 38 tests. The Linux run was attempted twice with one repetition and two declared CPUs/workers; both attempts returned busy (exit 75), so no Linux test result is claimed.
