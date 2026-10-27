export type E2EProfileName = "e2e" | "preview" | "internal" | "locked";
export const E2E_PROFILES: Record<E2EProfileName, { outDir: string; env: Record<string, string> }>;
export function e2eBuild(name: string): { args: string[]; env: Record<string, string> };
export function selfHostProfiles(specs: string[]): E2EProfileName[];
export function requiredProfiles(
  target: string,
  specs: string[],
  options?: { skipPreview?: boolean; selfHost?: string[] },
): E2EProfileName[];
