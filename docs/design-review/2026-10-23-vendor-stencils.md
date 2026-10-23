## Scope

Designer-agent review of the October 2026 vendor catalogue expansion against
`docs/UX-PRINCIPLES.md`, `docs/QUALITY.md` and `docs/I18N.md`. Reviewed the research,
58 vendor definitions and their behavioural parents, discovery aliases, category and
family assignment, translated stencil display helpers, catalogue details, icon
provenance, the Fastly search/add browser test, and the public Independent edge
storefront example. This review did not add controls or change implementation files.

## Findings and resolutions

The four initial source findings were addressed and rechecked in the source:

- Fastly Compute retains Cloudflare Workers' simulation behaviour but uses the
  existing neutral translated serverless-function description. It no longer names
  Cloudflare in its display description. Redpanda similarly uses the existing
  partitioned-log description rather than unrelated event-store wording.
- The example feature now uses the specific `examples.vendorStencils` message,
  “Vendor stencils”, instead of the ambiguous catalogue-tab label “Stencils”.
  Other locales currently fall back to English for this new message; that is a
  known translation limit, not a completed translation claim.
- Research tables now match Apigee's API Management parent and place both added
  brokers under Messaging.
- Broker labels now use the plain product names ActiveMQ and Redpanda. This keeps
  brand spelling stable without untranslated Queue/Topic common nouns that would
  differ from existing localized broker labels.

## Categories and discoverability

The nine existing categories are sufficient. CDN, WAF and DNS belong under Network;
identity and feature flags fit Security & config; payment, notification and model
APIs fit Clients & external. New storage stencils explicitly belong under Data,
brokers under Messaging, and CI/CD under Compute. This avoids placing branded
variants in Generic merely because their behavioural parent is generic.

Search aliases include common functional terms and alternate product names. Fastly
and Fastly Compute are separate, clearly named choices. Existing rail search,
family filtering, collapsed category counts, recent stencils, quick-add and details
provide discovery without another toolbar, filter row or vendor-specific control.
The added test exercises Fastly through the existing rail and adds the branded node.

## Icons and accessibility

Neutral category glyphs are appropriate when redistribution of a vendor mark is not
established. The visible brand name carries identity; colour is supplementary, so
vendors sharing a glyph remain distinguishable without colour. The glyphs preserve
the existing loading and normalization path. `docs/ICONS.md` records an ISC-licensed
Lucide glyph for every new stencil, including the new telemetry glyph.

The existing semantic buttons, accessible search name, Enter-to-add interaction,
focus behaviour and decorative icon `alt=""` remain in use. No new accessibility
barrier was identified by source inspection. Contrast, long-label clipping, keyboard
focus visibility and right-to-left layout require production visual verification;
this source review alone does not establish those outcomes.

## Public example

Independent edge storefront uses an invented shopping flow with a browser source,
CDN, WAF, edge function, receipt storage and payment API. Configuration and identity
remain dependencies, visually and behaviourally distinct from request flow. The
description explicitly says CDN caching and vendor performance are not simulated.
The authored layout separates the main flow and the lower dependency nodes, and
the example test checks receipt and payment completion within ten simulated seconds.
Live rendering, fit-view readability and edge routing have not yet been visually
verified in this review.

## Review limits

This is a source and authored-layout review, not a completed whole-app walkthrough.
No server was started and no full suite or axe audit was run by this reviewer.
An attempt to inspect the supplied production preview through the computer-use
browser API failed because no browser was available; the surface inventory returned
no apps or browsers. No preview page was opened. Findings were sent to the
implementation owner and the source resolutions rechecked. Production screenshots
and final test outcomes should be recorded separately or appended here when available.
