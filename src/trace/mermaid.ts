// A sequence model as Mermaid `sequenceDiagram` text. Arrows: async `-)` (open), sync `->>` (solid),
// replies `-->>` (dashed), retries `--)`; dead letters sit in a red `rect`. Failures and drops are
// notes over the node; gaps are notes spanning the diagram that say where the time went.

import { formatOffset } from "./journey";
import type { ArrowStyle, SequenceModel } from "./sequence";

const ARROWS: Record<ArrowStyle, string> = {
  async: "-)",
  sync: "->>",
  reply: "-->>",
  retry: "--)",
  dlq: "-)",
};

/** Mermaid sequence text: `;` ends a statement and `#` starts an entity, so both are escaped. */
export const sequenceText = (s: string) =>
  s
    .replace(/[#;]/g, (c) => (c === "#" ? "#35;" : "#59;"))
    .replace(/\r?\n/g, " ")
    .trim();

function ids(model: SequenceModel): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const p of model.participants) {
    let base = p.id.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "node";
    if (/^(end|participant|actor|as|note|loop|alt|else|opt|par|and|rect|critical|break|box)$/i.test(base))
      base = `n_${base}`;
    let id = base;
    for (let k = 2; used.has(id); k++) id = `${base}_${k}`;
    used.add(id);
    out.set(p.id, id);
  }
  return out;
}

export function toMermaid(model: SequenceModel, opts: { times?: boolean } = {}): string {
  const id = ids(model);
  const times = opts.times !== false;
  // Front matter is YAML: a double-quoted (JSON) string keeps "#" from starting a comment.
  const title = JSON.stringify(`${model.title} · ${model.summary}`.replace(/\r?\n/g, " "));
  const lines = ["---", `title: ${title}`, "---", "sequenceDiagram"];
  for (const p of model.participants) lines.push(`  participant ${id.get(p.id)} as ${sequenceText(p.label)}`);
  const first = id.get(model.participants[0]?.id ?? "");
  const lastP = id.get(model.participants.at(-1)?.id ?? "");
  const span = first && lastP && first !== lastP ? `${first},${lastP}` : first;
  for (const item of model.items) {
    if (item.kind === "gap") {
      if (span) lines.push(`  Note over ${span}: ⏱ ${sequenceText(item.text)}`);
      continue;
    }
    if (item.kind === "note") {
      lines.push(`  Note over ${id.get(item.over)}: ${sequenceText(item.text)}`);
      continue;
    }
    const at = times ? ` (${formatOffset(item.t)})` : "";
    const detail = item.detail ? `<br/>${sequenceText(item.detail)}` : "";
    const line = `${id.get(item.from)}${ARROWS[item.style]}${id.get(item.to)}: ${sequenceText(item.label)}${at}${detail}`;
    if (item.style === "dlq") lines.push("  rect rgba(209, 57, 63, 0.14)", `    ${line}`, "  end");
    else lines.push(`  ${line}`);
  }
  return lines.join("\n") + "\n";
}
