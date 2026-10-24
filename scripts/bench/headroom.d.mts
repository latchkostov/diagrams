export const HEADROOM_FLOOR: number;
export function bundleBudget(
  value: number,
  limit: number,
  base?: number,
): {
  headroom: number;
  warning: boolean;
  base?: number;
  delta?: number;
};
