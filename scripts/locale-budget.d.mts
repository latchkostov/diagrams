export const LOCALE_BUDGET: number;
export function localeSizes(outDir: string): { file: string; gzip: number }[];
export function checkLocaleSizes(sizes: { file: string; gzip: number }[]): { file: string; gzip: number } | undefined;
export const CORE_LOCALE_BUDGET: number;
export function checkCoreLocaleSizes(
  sizes: { file: string; gzip: number }[],
): { file: string; gzip: number } | undefined;
