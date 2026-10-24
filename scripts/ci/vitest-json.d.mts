export { JsonReporter as default } from "vitest/node";
export function withRunErrors(
  report: Record<string, unknown>,
  errors: readonly { name?: string; message?: string; stack?: string }[],
  reason?: string,
): Record<string, unknown>;
