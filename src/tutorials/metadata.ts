import { msg } from "../i18n";

/** Titles only. Entry points must never import the catalog's steps into startup or canvas. */
export const tutorialMetadata =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1"
    ? ([
        { id: "mobile-api", title: msg("tutorials.mobileApi.title") },
        { id: "quick-add", title: msg("tutorials.quickAdd.title") },
        { id: "dots-and-sides", title: msg("tutorials.dotsAndSides.title") },
        { id: "insert-on-edge", title: msg("tutorials.insertOnEdge.title") },
        { id: "property-sheet", title: msg("tutorials.propertySheet.title") },
        { id: "request-vs-message", title: msg("tutorials.requestVsMessage.title") },
      ] as const)
    : [];
