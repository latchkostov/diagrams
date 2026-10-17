export function buildE2E(
  name: string,
  execute?: (
    bin: string,
    args: string[],
    options: { env: Record<string, string>; live: boolean },
  ) => Promise<{ code: number }>,
): Promise<number>;
