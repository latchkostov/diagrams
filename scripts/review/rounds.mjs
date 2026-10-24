export const ANGLES = ["correctness", "architecture", "performance", "tests", "security", "accessibility", "types"];
export function roundPlan(state, { angles, allowRound4 = false, full = false } = {}) {
  const round = full ? 1 : (state?.round ?? 0) + 1;
  if (round > 3 && !allowRound4)
    throw new Error("Round cap reached: quarantine or merge; owner approval requires --allow-round-4");
  const selected =
    angles?.trim().split(/\s+/).filter(Boolean) ??
    (round === 1 ? ANGLES : ["correctness", ...(state?.openP1s ?? []).flatMap((x) => x.lenses)]);
  if (selected.some((angle) => !ANGLES.includes(angle)) || !selected.length) throw new Error("Unknown or empty ANGLES");
  const required = round > 1 ? ["correctness", ...(state?.openP1s ?? []).flatMap((x) => x.lenses)] : [];
  return { round, angles: [...new Set([...required, ...selected])], capped: round >= 3 && !allowRound4 };
}
export function nextState(plan, scope, issues, report) {
  const openP1s = issues.filter((x) => x.severity === "P0" || x.severity === "P1");
  return {
    round: plan.round,
    lastReviewedSha: scope.head,
    openP1Ids: openP1s.map((x) => x.id),
    openP1s,
    report,
    context: plan.context,
  };
}
