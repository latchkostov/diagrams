// Deterministic, cheap consolidator. Raw lens reports are never rewritten.
import { createHash } from "node:crypto";

export const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
const confidence = { high: 0, medium: 1, low: 2 };
const stop = new Set(["a", "an", "the", "to", "of", "in", "on", "for", "and", "when", "before", "after", "with"]);
const words = (title) =>
  new Set(
    title
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((x) => !stop.has(x))
      .map((x) => x.replace(/s$/, "")) ?? [],
  );
const fileKey = (file) => file.replaceAll("\\", "/").replace(/^\.\//, "");
export function sameIssue(a, b) {
  if (fileKey(a.file) !== fileKey(b.file) || Math.abs(a.line - b.line) > 12) return false;
  const left = words(a.title),
    right = words(b.title);
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared > 0 && shared / new Set([...left, ...right]).size >= 0.5;
}
export const compare = (a, b) =>
  rank[a.severity] - rank[b.severity] ||
  confidence[a.confidence] - confidence[b.confidence] ||
  a.file.localeCompare(b.file) ||
  a.line - b.line ||
  a.title.localeCompare(b.title);

export function consolidate(reports, plan) {
  const previous = plan.state?.openP1s ?? [];
  for (const { angle, report } of reports) {
    if (!Array.isArray(report.findings) || !Array.isArray(report.assessments) || typeof report.summary !== "string")
      throw new Error(`Invalid ${angle} report`);
    for (const old of previous) {
      const answers = report.assessments.filter((x) => x.id === old.id);
      if (answers.length !== 1 || !["fixed", "open"].includes(answers[0].status) || !answers[0].detail?.trim())
        throw new Error(`${angle} must assess ${old.id} once, with evidence`);
    }
  }
  const raw = reports.flatMap(({ angle, report }) =>
    report.findings.map((x) => {
      if (
        !Object.hasOwn(rank, x.severity) ||
        !Object.hasOwn(confidence, x.confidence) ||
        !Number.isSafeInteger(x.line) ||
        x.line < 1 ||
        [x.file, x.title, x.detail, x.suggestion].some((s) => typeof s !== "string" || !s.trim())
      )
        throw new Error(`Invalid finding from ${angle}`);
      if (x.previousId && !previous.some((old) => old.id === x.previousId))
        throw new Error(`Unknown previous issue ${x.previousId}`);
      return { ...x, file: fileKey(x.file), lenses: [angle] };
    }),
  );
  const excluded = raw.filter((x) => !plan.scope.files.includes(x.file));
  const findings = raw
    .filter((x) => plan.scope.files.includes(x.file))
    .map((x) => {
      const old = previous.find((old) => old.id === x.previousId || sameIssue(old, x));
      const capped = plan.round > 1 && !old && rank[x.severity] < 2 && !plan.scope.lines[x.file]?.includes(x.line);
      return {
        ...x,
        ...(old ? { id: old.id } : {}),
        ...(capped ? { severity: "P2", calibration: "New finding on an unchanged line; capped at P2." } : {}),
      };
    })
    .sort(compare);
  const clusters = [];
  for (const finding of findings) {
    // Complete linkage avoids merging a chain of nearby but unrelated issues.
    const cluster = clusters.find((items) =>
      items.every((x) => (x.id && x.id === finding.id) || sameIssue(x, finding)),
    );
    if (cluster) cluster.push(finding);
    else clusters.push([finding]);
  }
  const issues = clusters.map((items) => ({
    ...items[0],
    id:
      items.find((x) => x.id)?.id ??
      `R-${createHash("sha256")
        .update(`${items[0].file}:${items[0].line}:${[...words(items[0].title)].sort().join(" ")}`)
        .digest("hex")
        .slice(0, 10)}`,
    lenses: [...new Set(items.flatMap((x) => x.lenses))].sort(),
    evidence: items,
  }));
  const resolutions = [];
  for (const old of previous) {
    const answers = reports.map(({ angle, report }) => ({ angle, ...report.assessments.find((x) => x.id === old.id) }));
    const fixed =
      answers.every((x) => x.status === "fixed") && !issues.some((x) => x.id === old.id && rank[x.severity] < 2);
    resolutions.push({ id: old.id, status: fixed ? "fixed" : "open", answers });
    if (!fixed) {
      const current = issues.find((x) => x.id === old.id);
      if (!current) issues.push(old);
      else {
        if (rank[current.severity] > rank[old.severity]) current.severity = old.severity;
        current.lenses = [...new Set([...old.lenses, ...current.lenses])].sort();
      }
    }
  }
  return { issues: issues.sort(compare), resolutions, excluded, rawCount: raw.length };
}

export function renderReport(name, plan, result, reports) {
  const counts = Object.keys(rank)
    .map((s) => `${s}: ${result.issues.filter((x) => x.severity === s).length}`)
    .join(" · ");
  const lines = [
    `# Review ${name}`,
    "",
    "## Exact files reviewed",
    "",
    ...plan.scope.files.map((file) => `- ${JSON.stringify(file)}`),
    ...(plan.scope.files.length ? [] : ["(none)"]),
    "",
    `Round ${plan.round} · HEAD ${plan.scope.head} · ${plan.scope.mode}`,
    "",
    `${counts} (distinct issues; ${result.rawCount} raw findings)`,
    "",
    "## Summaries",
    "",
    ...reports.map(({ angle, report }) => `- **${angle}**: ${report.summary}`),
    "",
    "## Previous P1 assessments",
    "",
    ...result.resolutions.flatMap((x) => [
      `- **${x.id}: ${x.status}**`,
      ...x.answers.map((a) => `  - ${a.angle}: ${a.status} — ${a.detail}`),
    ]),
    "",
    "## Findings",
    "",
  ];
  for (const x of result.issues)
    lines.push(
      `### [${x.severity}/${x.confidence}] ${x.id}: ${x.title}`,
      `\`${x.file}:${x.line}\` · lenses: ${x.lenses.join(", ")}`,
      "",
      x.detail,
      "",
      ...(x.calibration ? [x.calibration, ""] : []),
      ...(!plan.capped ? [`**Fix:** ${x.suggestion}`, ""] : []),
    );
  if (plan.capped) {
    lines.push(
      "## QUARANTINE-OR-MERGE",
      "",
      "The fix-round cap is reached. Owner decides quarantine or merge; no automatic quarantine or merge is performed.",
      "",
    );
    for (const x of result.issues.filter((x) => rank[x.severity] < 2))
      lines.push(
        `- **${x.id}**: suggest a dated backlog fragment \`docs/backlog/YYYY-MM-DD-review-${x.id.toLowerCase()}.md\` with \`## ${x.title}\`, reproduction at \`${x.file}:${x.line}\`, owner and follow-up: ${x.suggestion}`,
      );
    lines.push(
      "",
      "If a failing test needs quarantine, use a targeted test.fixme referencing that fragment. Owner approval for another fix round: --allow-round-4.",
    );
  }
  return `${lines.join("\n")}\n`;
}
