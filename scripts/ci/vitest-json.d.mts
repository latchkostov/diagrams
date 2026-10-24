export { JsonReporter as default } from "vitest/node";
export function withRunErrors(
  report: Record<string, unknown>,
  errors: readonly { name?: string; message?: string; stack?: string }[],
  reason?: string,
  modules?: readonly {
    errors(): { name?: string; message?: string; stack?: string }[];
    children: { allSuites(): Iterable<{ errors(): { name?: string; message?: string; stack?: string }[] }> };
  }[],
): Record<string, unknown>;
