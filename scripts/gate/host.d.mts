export function probePorts(base: number): Promise<number>;
export function pickPorts(probe?: (base: number) => Promise<number>): Promise<number>;
export function acquireLock(
  common: string,
  platform: string,
  waiting?: () => void,
  port?: number,
  signal?: AbortSignal,
): Promise<(() => Promise<void>) & { port: number }>;
