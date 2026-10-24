/** Fixed limits; warnings schedule a separate trim, never reject an otherwise in-budget feature. */
export const HEADROOM_FLOOR = 8192;

export function bundleBudget(value, limit, base) {
  const headroom = limit - value;
  return {
    headroom,
    warning: headroom >= 0 && headroom < HEADROOM_FLOOR,
    ...(Number.isFinite(base) ? { base, delta: value - base } : {}),
  };
}
