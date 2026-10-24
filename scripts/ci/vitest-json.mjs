import { JsonReporter } from "vitest/node";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Stock Vitest JSON omits runner errors; a known timeout must not hide an unrelated rejection. */
export function withRunErrors(report, errors, reason, modules = []) {
  const suiteErrors = modules.flatMap((module) =>
    [module, ...module.children.allSuites()].flatMap((suite) => suite.errors()),
  );
  return {
    ...report,
    unhandledErrors: [...errors, ...suiteErrors].map(({ name, message, stack }) => ({ name, message, stack })),
    interrupted: reason === "interrupted",
  };
}

export default class MachineJsonReporter extends JsonReporter {
  constructor(options = {}) {
    super(options);
  }

  async onTestRunEnd(modules, errors, reason) {
    await super.onTestRunEnd(modules);
    const configured = this.options.outputFile ?? this.ctx.config.outputFile;
    const file = typeof configured === "string" ? configured : configured?.json;
    if (!file) throw new Error("Machine JSON reporter requires --outputFile or --outputFile.json");
    const target = resolve(this.ctx.config.root, file);
    const report = JSON.parse(readFileSync(target, "utf8"));
    writeFileSync(target, JSON.stringify(withRunErrors(report, errors, reason, modules)));
  }
}
