/** Untrusted radii never reach CSS. Finite numbers clamp to the inspector's range. */
export function borderRadius(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(40, value)) : undefined;
}
