import { msg } from "../i18n";
import { exampleSummary, type Example } from "./index";
import { groupByTheme, type ExampleTheme } from "./themes";

import { exampleFeatures } from "./features";
export { exampleFeatures } from "./features";

/** Full gallery copy is downloaded with the gallery, outside startup. */
export const gallerySummary = (example: Example) =>
  example.slug === "retry-storm" ? msg("examples.retryStormGallerySummary")() : exampleSummary(example);

/** Every search word must match; labels are resolved in the current language. */
export function filterExamples(items: readonly Example[], query: string, feature = "") {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groupByTheme(
    items.filter((e) => {
      if (feature && !e.shows?.includes(feature)) return false;
      const text = [
        e.slug,
        e.title,
        gallerySummary(e),
        e.description,
        ...(e.slug === "retry-storm" ? ["circuit breaker"] : []),
        ...(e.shows ?? []).map((id) => exampleFeatures.find((f) => f.id === id)?.label() ?? id),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    }),
    (e) => e.theme,
  );
}

const themeLabels = {
  systems: msg("examples.themeSystems"),
  streaming: msg("examples.themeStreaming"),
  data: msg("examples.themeData"),
  cloud: msg("examples.themeCloud"),
  integration: msg("examples.themeIntegration"),
  reliability: msg("examples.themeReliability"),
};
export const exampleThemeLabel = (theme: ExampleTheme) => themeLabels[theme]();
