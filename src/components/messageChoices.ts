/** Each population has its own rendering cap, so selections cannot crowd out offered choices. */
export const MAX_CHOICES = 100;

export function selectMessageChoices(
  choices: readonly string[],
  value: readonly string[] = [],
  search = "",
  limit = MAX_CHOICES,
) {
  const all = [...new Set([...choices, ...value])];
  const selected = new Set(value);
  const query = all.length > limit ? search.toLocaleLowerCase() : "";
  const exact = (type: string) => !!query && type.toLocaleLowerCase() === query;
  const rank = (types: string[]) => [...types.filter(exact), ...types.filter((type) => !exact(type))];
  const matching = query ? all.filter((type) => type.toLocaleLowerCase().includes(query)) : all;
  const matchingSelected = rank(matching.filter((type) => selected.has(type)));
  const matchingUnselected = rank(matching.filter((type) => !selected.has(type)));
  const pinned = matchingSelected.slice(0, limit);
  const options = rank(all.length > limit ? [...pinned, ...matchingUnselected.slice(0, limit)] : matching);
  return {
    all,
    selected,
    options,
    matchingSelectedOverflow: Math.max(0, matchingSelected.length - limit),
    matchingUnselectedOverflow: Math.max(0, matchingUnselected.length - limit),
    hiddenSelectionCount: selected.size - pinned.length,
  };
}
