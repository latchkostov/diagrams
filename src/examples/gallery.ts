import { msg } from "../i18n";
import { exampleSummary, type Example } from "./index";
import { groupByTheme, type ExampleTheme } from "./themes";

export const exampleFeatures = [
  { id: "vendorStencils", label: msg("examples.vendorStencils") },
  { id: "brandedClients", label: msg("examples.brandedClients") },
  { id: "resilience", label: msg("resilience.gallery") },
  { id: "requestsWait", label: msg("examples.requestsWait") },
  { id: "faultDrills", label: msg("examples.faultDrills") },
  { id: "partitions", label: msg("examples.partitions") },
  { id: "rateLimits", label: msg("examples.rateLimits") },
  { id: "networkDevices", label: msg("examples.networkDevices") },
  { id: "autoscaling", label: msg("examples.autoscaling") },
  { id: "routing", label: msg("examples.routing") },
  { id: "latency", label: msg("examples.latency") },
];

/** Every search word must match; labels are resolved in the current language. */
export function filterExamples(items: readonly Example[], query: string, feature = "") {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groupByTheme(
    items.filter((e) => {
      if (feature && !e.shows?.includes(feature)) return false;
      const text = [
        e.slug,
        e.title,
        exampleSummary(e),
        e.description,
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
