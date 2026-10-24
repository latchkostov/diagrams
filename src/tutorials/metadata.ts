import { msg } from "../i18n";

/** Titles only. Entry points must never import the catalog's steps into startup or canvas. */
export const tutorialMetadata = [{ id: "mobile-api", title: msg("tutorials.mobileApi.title") }] as const;
