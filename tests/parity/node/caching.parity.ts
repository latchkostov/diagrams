import { it } from "vitest";
import type { DiagramFile } from "../../../src/model/types";
import aside from "../corpus/w3-cache-aside.diagram.json";
import { diagramToDrawio } from "../../../src/interop/drawio/write";
import { expectGoldenText } from "../lib/golden";

it("preserves W3 caching and purge Drills in draw.io", () => {
  const d = structuredClone(aside) as DiagramFile;
  const step = d.simulations?.[0].timeline?.[0];
  if (!step) throw new Error("The W3 fixture needs a purge step");
  step.action = {
    do: "fault",
    fault: { kind: "purge", node: "cache", mode: "soft", reason: "deploy" },
    drill: "cold-cache",
  };
  expectGoldenText("w3-cache.drawio", diagramToDrawio(d));
});
