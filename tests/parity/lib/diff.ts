// Readable differences between a golden and the actual output: JSON paths with old → new values for data,
// and a line diff for text. Both are capped, so a run that changes everything still prints a short report.

const VALUE_WIDTH = 100;

function show(value: unknown): string {
  const text = value === undefined ? "(absent)" : JSON.stringify(value);
  return text.length > VALUE_WIDTH ? `${text.slice(0, VALUE_WIDTH - 1)}…` : text;
}

function keyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}${path ? "." : ""}${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** Arrays whose items all have a distinct string or number `id` are compared by id, not by position. */
function byId(items: unknown[]): Map<string, unknown> | undefined {
  if (!items.length) return undefined;
  const map = new Map<string, unknown>();
  for (const item of items) {
    const id = item && typeof item === "object" && !Array.isArray(item) ? (item as { id?: unknown }).id : undefined;
    if ((typeof id !== "string" && typeof id !== "number") || map.has(String(id))) return undefined;
    map.set(String(id), item);
  }
  return map;
}

/** Every difference between two JSON values, as "path: old → new" lines (at most `limit`), and the total. */
export function jsonDiff(before: unknown, after: unknown, limit = 40): { lines: string[]; total: number } {
  const lines: string[] = [];
  let total = 0;
  const note = (line: string) => {
    total++;
    if (lines.length < limit) lines.push(line);
  };
  const walk = (a: unknown, b: unknown, path: string) => {
    if (a === b) return;
    const aObj = a !== null && typeof a === "object";
    const bObj = b !== null && typeof b === "object";
    if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
      note(`${path || "(root)"}: ${show(a)} → ${show(b)}`);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const ia = byId(a);
      const ib = byId(b);
      if (ia && ib) {
        const order = (m: Map<string, unknown>) => [...m.keys()].join("\u0000");
        for (const [id, item] of ia) {
          if (!ib.has(id)) note(`${path}[id=${id}]: removed ${show(item)}`);
          else walk(item, ib.get(id), `${path}[id=${id}]`);
        }
        for (const [id, item] of ib) if (!ia.has(id)) note(`${path}[id=${id}]: added ${show(item)}`);
        if ([...ia.keys()].every((id) => ib.has(id)) && ia.size === ib.size && order(ia) !== order(ib))
          note(`${path}: order ${show([...ia.keys()])} → ${show([...ib.keys()])}`);
        return;
      }
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) walk(a[i], b[i], `${path}[${i}]`);
      return;
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const key of Object.keys(ao)) walk(ao[key], bo[key], keyPath(path, key));
    for (const key of Object.keys(bo)) if (!(key in ao)) walk(undefined, bo[key], keyPath(path, key));
    const ak = Object.keys(ao).filter((k) => k in bo);
    const bk = Object.keys(bo).filter((k) => k in ao);
    if (ak.join("\u0000") !== bk.join("\u0000")) note(`${path || "(root)"}: key order ${show(ak)} → ${show(bk)}`);
  };
  walk(before, after, "");
  return { lines, total };
}

/**
 * A line diff in unified style (`-` golden, `+` actual, two lines of context), at most `limit` lines. The common
 * start and end are trimmed first; the middle is aligned by longest common subsequence when it is small enough,
 * else shown as removed then added.
 */
export function textDiff(before: string, after: string, limit = 60): { lines: string[]; total: number } {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops: string[] = [];
  if (midA.length * midB.length <= 4_000_000) {
    // LCS table over the differing middle.
    const n = midA.length;
    const m = midB.length;
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push(`  ${midA[i]}`);
        i++;
        j++;
      } else if (j < m && (i >= n || table[i][j + 1] >= table[i + 1][j])) ops.push(`+ ${midB[j++]}`);
      else ops.push(`- ${midA[i++]}`);
    }
  } else {
    for (const line of midA) ops.push(`- ${line}`);
    for (const line of midB) ops.push(`+ ${line}`);
  }
  const total = ops.filter((op) => op[0] !== " ").length;
  const context = [
    ...a.slice(Math.max(0, start - 2), start).map((l) => `  ${l}`),
    ...ops,
    ...a.slice(endA, endA + 2).map((l) => `  ${l}`),
  ];
  const clip = (line: string) => (line.length > 200 ? `${line.slice(0, 199)}…` : line);
  const lines = [`@@ line ${start + 1} @@`, ...context.slice(0, limit).map(clip)];
  if (context.length > limit) lines.push(`… ${context.length - limit} more lines`);
  return { lines, total };
}
