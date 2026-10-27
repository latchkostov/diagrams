export const LOCALE_BUDGET: number;
export function localeSizes(outDir: string): { file: string; gzip: number }[];
export function checkLocaleSizes(sizes: { file: string; gzip: number }[]): { file: string; gzip: number } | undefined;
