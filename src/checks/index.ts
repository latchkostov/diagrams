// Architecture checks: the lazy chunk's public surface. Import it with `import("../checks")`, never statically
// from code that loads at startup (src/lib/bundleSplit.build.test.ts guards it).
export { runChecks, summarize, onlyRules, RULES, type RunOptions } from "./run";
export { agentReport, type AgentFinding, type AgentReport } from "./report";
export type { CheckFix, CheckResult, CheckRule, CheckSeverity, Finding } from "./types";
