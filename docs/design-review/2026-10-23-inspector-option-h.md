## Option H implementation review (#265)

The owner-approved hybrid uses the ledger for editable content, headline facts for planning explanations, sticky bands and four existing Segmented controls. The review adds no top-bar controls. Labels, hints, descriptions, checkbox choices and connection targets align in the value column; Description and read-only fact blocks retain full width.

Compared implementation captures against the approved light, dark, 300 px, Arabic, Request, Live and autoscaling references. Live retains its existing internal layout. Production captures omit the development-only Lab tab and show naturally different live values. Capacity formulas gain bidi isolation, correcting the reference's RTL punctuation. Custom imported jitter values remain represented instead of silently losing their selection.

The designer-agent review found that flex buttons did not actually ellipsize long translations; Inspector segment buttons now use block text layout. Captures wait for translated Emits controls, and the autoscaling view keeps Advanced collapsed to inspect its summary. English and Arabic Request views match the approved field rhythm and pool explanation placement. Keyboard and axe coverage remain in the Inspector regression suite.

Older p3-w1 documents retain their one pool field hint because they do not render the later Pool & reply handling disclosure. Newer documents use only the group description; this preserves the existing legacy keyboard flow without duplicating the sentence.

The narrow fallback retains 16 px between stacked paired fields; the wide ledger uses 10 px. The Linux matrix caught a test that incorrectly applied the wide spacing at a 1000 px viewport. Its exact assertion now covers both approved values.

The connection-policy theme test now expects the approved 70% line-token mix, while retaining its exact 1 px width and secondary-ink comparisons. Its former solid-line expectation described the previous design.

A saved simulation edit briefly read old metadata from the editor while the live controller already held the new definition. That transient draft classification unmounted the focused radio. The editor now stages metadata reads immediately, matching its ordered command updates. A unit observer and the unchanged breaker keyboard-focus assertion cover the gap. A flushSync wrapper was tested and rejected because it did not correct the stale getter.

Queued metadata updates remain functional updates when handed to React, preserving edits that arrived before the next editor render. The regression test covers both the immediate inspector read and the queued document result. Direct metadata and node-size reads also avoid allocating a dependency copy; the canvas-first-view bundle remains below the pre-Option-H comparison.
