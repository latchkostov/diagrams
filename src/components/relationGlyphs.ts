// Relationship glyphs on Lucide's 24 px grid (ISC; see docs/ICONS.md): sliders-horizontal, key-round,
// id-card, activity, rocket, link-2 and lock, each flattened to one stroked path. The same picture
// marks a relationship everywhere: on the edge, in the Relationship ▸ menu, the inspector, the node
// pips and the settings card. Message and Request (flows) are a dashed and a solid arrow.

export const RELATION_GLYPHS = {
  "rel-any": "M3 12h.01M7.5 12h.01M12 12h.01M16 7l5 5-5 5",
  "rel-message": "M3 12h3M9 12h3M15 12h5M16 8l4 4-4 4",
  "rel-request": "M3 12h17M16 8l4 4-4 4",
  "rel-config": "M10 5H3m9 14H3M14 3v4m2 10v4m5-9h-9m9 7h-5m5-14h-7m-6 5v4m0-2H3",
  "rel-secret":
    "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4zM16.5 7.5h.01",
  "rel-identity":
    "M13 19a4 4 0 0 0-8 0m11-9h2m-2 4h2M12 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  "rel-telemetry":
    "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  "rel-deploy":
    "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05",
  "rel-depends": "M9 17H7A5 5 0 0 1 7 7h2m6 0h2a5 5 0 1 1 0 10h-2m-7-5h8",
  lock: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4",
} as const;

export type RelationGlyphName = keyof typeof RELATION_GLYPHS;
