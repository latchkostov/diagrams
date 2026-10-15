/** Keep the current work visible while limiting menu chrome. Input is most recent first. */
export function workChoices<T extends { slug: string; group: "yours" | "examples" }>(
  options: readonly T[],
  current?: string,
  limit = 8,
) {
  const yours = options.filter((o) => o.group === "yours");
  const active = yours.find((o) => o.slug === current);
  const ordered = active ? [active, ...yours.filter((o) => o !== active)] : yours;
  return { items: ordered.slice(0, limit), overflow: yours.length > limit };
}
