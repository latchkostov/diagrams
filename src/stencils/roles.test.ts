import { expect, it, vi } from "vitest";
import { catalog } from "./catalog";
import { stencilRole } from "./roles";
import { createEngine } from "../sim/engine";

vi.mock("./registry", () => {
  throw new Error("Headless engine must not load the UI asset registry");
});

it("resolves every catalog role and the fallback without loading UI assets", () => {
  for (const stencil of catalog) expect(stencilRole(stencil.id)).toBe(stencil.simRole);
  const engine = createEngine();
  engine.load({
    format: "diagrams/v1",
    title: "Headless",
    edges: [],
    nodes: [{ id: "unknown", label: "Unknown", stencil: "absent", x: 0, y: 0 }],
  });
  expect(engine.snapshot().nodes.unknown.role).toBe("processor");
});
