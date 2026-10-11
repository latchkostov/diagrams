/** The themes the example picker and the start card group examples by, in display order. */
export const EXAMPLE_THEMES = [
  { id: "streaming", label: "Event streaming" },
  { id: "data", label: "Data & AI" },
  { id: "cloud", label: "Cloud apps" },
  { id: "integration", label: "Integration" },
  { id: "reliability", label: "Reliability" },
] as const;

/** One theme: a stable id (section identity and test IDs) and its display label (copy only). */
export type ExampleThemeInfo = (typeof EXAMPLE_THEMES)[number];
export type ExampleTheme = ExampleThemeInfo["id"];

export function themeInfo(id: ExampleTheme): ExampleThemeInfo {
  const theme = EXAMPLE_THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`Unknown example theme: ${id}`);
  return theme;
}

export interface ThemeSection<T> {
  /** Undefined for the section of unthemed items. */
  theme?: ExampleThemeInfo;
  items: T[];
}

/**
 * Groups items by theme id, in EXAMPLE_THEMES order, with unthemed items first; within a section,
 * items keep their input order. Empty themes are left out. The picker and the start card both use
 * this, so a theme's identity and position never depend on its label or on the order of the list.
 */
export function groupByTheme<T>(
  items: readonly T[],
  themeOf: (item: T) => ExampleTheme | undefined,
): ThemeSection<T>[] {
  const unthemed = items.filter((item) => themeOf(item) === undefined);
  const sections: ThemeSection<T>[] = unthemed.length ? [{ items: unthemed }] : [];
  for (const theme of EXAMPLE_THEMES) {
    const inTheme = items.filter((item) => themeOf(item) === theme.id);
    if (inTheme.length) sections.push({ theme, items: inTheme });
  }
  return sections;
}
