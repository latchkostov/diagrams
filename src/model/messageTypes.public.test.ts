import { expect, it } from "vitest";
import type { DiagramFile } from "./types";
import { MESSAGE_TYPE_WORK_LIMIT, messageTypeBudget, messageTypesAt } from "./messageTypes";
import { runChecks } from "../checks/run";

const examples = import.meta.glob<DiagramFile>("../examples/*.json", { eager: true, import: "default" });
it.each(Object.entries(examples))("keeps at least fourfold message-work headroom for %s", (path, diagram) => {
  const budget = messageTypeBudget();
  const result = messageTypesAt(diagram, undefined, budget);
  const work = MESSAGE_TYPE_WORK_LIMIT - budget.remaining;
  if (process.env.OP_LOG) console.info(`${path.replace(/^.*\/|\.json$/g, "")}: ${work}`);
  expect(work).toBeLessThanOrEqual(MESSAGE_TYPE_WORK_LIMIT / 4);
  expect(result.incompleteReasons ?? []).not.toContain("work-budget");
  // Acyclic processor paths prove the loop check even when timeline type propagation remains partial.
  expect(runChecks(diagram, { rules: ["message-loop"] }).findings).toEqual([]);
});
