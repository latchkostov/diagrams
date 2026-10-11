/** `base-N` with the smallest N not in `taken`. A trailing `-N` on the base is stripped first. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const stem = base.replace(/-\d+$/, "") || "node";
  let i = 1;
  while (taken.has(`${stem}-${i}`)) i++;
  return `${stem}-${i}`;
}

/** Id stem for a node created from a stencil, e.g. "kafka.topic" → "topic". */
export function stencilIdBase(stencilId: string): string {
  return (
    stencilId
      .split(".")
      .slice(-1)[0]
      .replace(/[^a-z0-9-]/gi, "") || "node"
  );
}
