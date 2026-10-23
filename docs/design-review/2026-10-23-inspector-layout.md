## Owner request and layout

Implemented the owner's request for breathing room between fields and a calmer Inspector while preserving control appearance. Shared tokens define the 16 px horizontal inset, 4/6/16 px field rhythm, 36 px section header and 20 px section bottom. Section, Field, PairedFields, Fieldset, Subgroup and disclosure primitives serve the panels. Native explanation disclosures and Live hover rows share their row styling; read-only figures use the existing ReadoutFacts component.

## Visual review

Reviewed the before/after matrix using only an invented Orders/Payments diagram: service, database, queue, topic, broker, cache, gateway, client, external API, serverless, Kubernetes, storage and network; Request, Message, Dependency and Config; note, text, boundary and Diagram. Profiles: 1440×900 light/dark, 1280×800 light. The full matrix is under `C:\Users\latch\bin\codex-tasks\inspector-layout\`.

![Request before](inspector-layout/before-request.png)

![Request after](inspector-layout/after-request.png)

![Service before](inspector-layout/before-service.png)

![Service after](inspector-layout/after-service.png)

The designer review identified and the implementation corrected: missing first-level subgroup rules, RTL open chevrons, role-chip contrast on hover, managed-stencil summaries, translated enum labels, inapplicable dependency travel/reply summaries, narrow formula wrapping, and loose Settings/retry/device hints. Message rules use the same subgroup primitive. Nested disclosures keep one nesting level. Boundary and annotation size fields stack in narrow sheets.

## Verification and assertions

The new `inspector-layout.spec.ts` covers all representative node summaries, usable identity fields while Simulation downloads, measured 16 px complete-field gaps and 6 px hint gaps, live summary updates, paired/stacked layouts, semantic retry fieldsets, six light/dark axe cases, Arabic chevrons and long-string/narrow-fact overflow. The fixture is available as the Lab's Inspector layout preset.

Three existing assertions intentionally follow the new structure; a fourth test gains a readiness precondition:

- `planning-p1.spec.ts`: the combined inline capacity/formula check now checks the same capacity and the exact separate formula value.
- `inspector-live.spec.ts`: checks the exact Live title and the toggle's accessible name, which now includes the status chip placed before the right chevron.
- `round3.test.ts`: expects the same final peer inside the new `strong` element; the indexed-lookup bound stays unchanged.
- `requests-wait-ux.spec.ts`: waits for Request fields before pressing Tab while the planning download remains held; every focus and geometry assertion stays unchanged.

The rhythm regression is verified against a production bundle with the field gap temporarily restored to 6 px, then the implementation is restored. Required Linux repeats, parity, static checks and bundle measurements are recorded in the delivery report.

The full browser run caught the visible pool hint entering its input's accessible name. Simulation inputs explicitly retain their label and unit as the name, with the hint remaining a separate description. The existing exact “Connection pool” assertion is unchanged; the rhythm case also checks the timeout's exact name and hint description.

The mixed-selection fit check also caught the legacy body's extra 24 px below the new section spacing. Sections now own the bottom spacing, so the body adds no second bottom gutter. The original one-screen and last-control bounds stay unchanged.

## Choices rejected

The Linux load pass also preserves the existing 640 px field-width cap on ultrawide sheets. Request fields retain their independent download and Retry contract. The first keyboard-pass test waits for those fields while keeping planning blocked, then keeps the exact focus and position assertions. Eager Request fields were rejected because they prevented the Inspector from remaining usable while that independent download was held.

No new global controls, control restyling, deeper indentation or forced field reordering. Existing keyboard order remains intact. Deferring the entire node panel shifted shared code into Live and exceeded its bundle budget, so only Simulation fields are deferred. Bundle thresholds are unchanged.

## Parity

The sole intentional golden change is `node/i18n/catalogs.json`: 24 English messages, their namespace hashes and fallback accounting. No other output is intentionally changed.
