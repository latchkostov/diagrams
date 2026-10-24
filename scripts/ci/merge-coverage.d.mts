import type { CoverageMapData } from "@vitest/istanbul-lib-coverage";
export function mergeCoverage(parts: readonly CoverageMapData[]): CoverageMapData;
export function writeCoverage(parts: readonly CoverageMapData[], directory: string): Promise<void>;
