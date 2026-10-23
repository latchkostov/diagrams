## Branded client stencils

The ten frameworks live beside the generic browser and mobile app under Clients. Search puts the exact
framework first; generic browsers remain discoverable for Vue, Angular and Svelte. No toolbar control,
panel, menu level or setting is added. Keyboard search and Enter use the existing insertion path.

Framework names remain untranslated; descriptions and the gallery feature use translated messages.
Vue and SwiftUI keep a recognizable neutral device glyph with their brand name and accent because their
artwork has restricted redistribution terms. React Native shares React's mark. These are traffic sources,
including Next.js and Nuxt: this feature represents their browser clients, not server rendering services.

The existing AWS orders example now shows its storefront as Next.js, with unchanged traffic and wiring.
The review keeps the current chrome budget, source placement, keyboard affordances and undo behaviour.

The size review also found that appearance settings imported renderer components during startup.
Separating their metadata keeps the same three renderers and dimensions while letting icons load with
the canvas or gallery. A production-build assertion now refuses icon URLs at startup; restoring the eager
renderer import fails that assertion. All node-variant and English/pseudo-locale display checks pass.
