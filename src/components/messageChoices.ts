/** Each population has its own rendering cap, so selections cannot crowd out offered choices. */
export const MAX_CHOICES = 100;
const empty: readonly string[] = [];
// The editor replaces vocabulary arrays on change. Weak keys release old diagrams and filter snapshots.
const normalized = new WeakMap<readonly string[], Map<string, string>>();
const populations = new WeakMap<readonly string[], WeakMap<readonly string[], ReturnType<typeof population>>>();
function normalize(types: readonly string[]) {
  let entries = normalized.get(types);
  if (!entries) {
    entries = new Map();
    for (const type of types) if (!entries.has(type)) entries.set(type, type.toLocaleLowerCase());
    normalized.set(types, entries);
  }
  return entries;
}
function population(choices: readonly string[], value: readonly string[]) {
  return {
    all: [...new Set([...choices, ...value])],
    selected: new Set(value),
    entries: undefined as Map<string, string> | undefined,
  };
}

export function selectMessageChoices(
  choices: readonly string[],
  value: readonly string[] = empty,
  search = "",
  limit = MAX_CHOICES,
) {
  let byValue = populations.get(choices);
  if (!byValue) populations.set(choices, (byValue = new WeakMap()));
  let indexed = byValue.get(value);
  if (!indexed) byValue.set(value, (indexed = population(choices, value)));
  const { all, selected } = indexed;
  const query = search && all.length > limit ? search.toLocaleLowerCase() : "";
  // Single-select and empty-query pickers need only authored names, even when their arrays are fresh.
  const entries = query ? (indexed.entries ??= new Map([...normalize(choices), ...normalize(value)])) : undefined;
  const buckets = () => ({ exact: [] as string[], partial: [] as string[], count: 0 });
  const chosen = buckets();
  const offered = buckets();
  for (const type of all) {
    const normalizedType = entries?.get(type);
    if (query && !normalizedType!.includes(query)) continue;
    const bucket = selected.has(type) ? chosen : offered;
    bucket.count++;
    const matches = query && normalizedType === query ? bucket.exact : bucket.partial;
    if (matches.length < limit) matches.push(type);
  }
  const bounded = (bucket: ReturnType<typeof buckets>) => [...bucket.exact, ...bucket.partial].slice(0, limit);
  const pinned = bounded(chosen);
  const candidates = all.length > limit ? [...pinned, ...bounded(offered)] : all;
  // Only bounded candidates are ranked; an empty query preserves authored order without ranking.
  const options = query
    ? [
        ...candidates.filter((type) => entries!.get(type) === query),
        ...candidates.filter((type) => entries!.get(type) !== query),
      ]
    : candidates;
  return {
    all,
    selected,
    options,
    matchingSelectedOverflow: Math.max(0, chosen.count - limit),
    matchingUnselectedOverflow: Math.max(0, offered.count - limit),
    hiddenSelectionCount: selected.size - pinned.length,
  };
}
