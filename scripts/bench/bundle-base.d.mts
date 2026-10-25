export function bundleBase(
  out: string,
  root?: string,
): { sha: string; metrics: { id?: string; value: number }[] } | undefined;
