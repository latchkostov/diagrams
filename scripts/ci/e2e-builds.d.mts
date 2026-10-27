import type { E2EProfileName } from "../e2e-profiles.mjs";
export function requiredProfiles(target: string, specs: string[]): E2EProfileName[];
export function buildArtifacts(
  specs: string[],
  build?: (name: string) => Promise<number>,
  target?: string,
): Promise<void>;
export function verifyArtifacts(target: string, specs: string[], root?: string): void;
