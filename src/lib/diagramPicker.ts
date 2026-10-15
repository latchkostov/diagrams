/** Keep the current work visible while limiting menu chrome. Input is most recent first. */
export function workChoices<T extends { slug: string; group: "yours" | "examples" }>(
  options: readonly T[],
  current?: string,
  limit = 8,
) {
  const yours = options.filter((o) => o.group === "yours");
  const active = yours.find((o) => o.slug === current);
  // Shared work has no row in Your diagrams, so it must never fall into library overflow.
  const shared = yours.find((o) => o.slug === "shared");
  const pinned = [...new Set([active, shared].filter((o): o is T => o !== undefined))];
  const ordered = [...pinned, ...yours.filter((o) => !pinned.includes(o))];
  return { items: ordered.slice(0, limit), overflow: yours.length > limit };
}
