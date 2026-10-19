/** Node documentation is shared by authoring, native files and clipboard payloads. */
export const DOCUMENTATION_LIMITS = { maxLength: 50_000, maxDiagramLength: 2000 } as const;

export function validDocumentation(
  value: unknown,
  maxLength: number = DOCUMENTATION_LIMITS.maxLength,
): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= maxLength);
}
