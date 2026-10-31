/* eslint-disable local/no-literal-ui-text -- Invented fixture labels are test input. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importFiles } from "../interop/formats";
import { holds, nearMiss, resolveSubjects, type SandboxView } from "./checks";
import type { ProductObservations } from "../lib/observations";
import { workbenchTour } from "./catalog/workbenchTour";
import { libraryReuse } from "./catalog/libraryReuse";
import { importAndReview } from "./catalog/importAndReview";
import { dotsAndSides } from "./catalog/dotsAndSides";
import { quickAdd } from "./catalog/quickAdd";
import type { DiagramFile } from "../model/types";
import type { Tutorial } from "./types";

const source = { documentId: "practice", identity: {} };
function met(
  lesson: Tutorial,
  id: string,
  diagram: DiagramFile,
  observations: Partial<ProductObservations> = {},
  extra: Partial<SandboxView> = {},
) {
  return holds(
    lesson.steps.find((step) => step.id === id)!.check,
    { diagram, live: false, processed: () => 0, observations, ...extra },
    resolveSubjects(lesson, diagram),
  );
}
const start = (lesson: Tutorial) => {
  if (typeof lesson.start !== "function") throw new Error("Expected local seed");
  return lesson.start();
};

describe("first diagram practice evidence", () => {
  it("requires the PostgreSQL result for the unassisted search, not another connected store", () => {
    const diagram = start(quickAdd);
    diagram.nodes.push(
      { id: "app", stencil: "client.browser", label: "Browser", x: 0, y: 0 },
      { id: "api", stencil: "generic.service", label: "Orders API", x: 300, y: 0 },
      { id: "db", stencil: "mysql", label: "MySQL", x: 600, y: 0 },
    );
    diagram.edges.push({ id: "write", from: "api", to: "db" });
    expect(met(quickAdd, "grow-db", diagram)).toBe(false);
    diagram.nodes[2].stencil = "postgres";
    expect(met(quickAdd, "grow-db", diagram)).toBe(true);
  });
  it("requires matching search results, a closed tool surface and no accidental addition", () => {
    const diagram = start(workbenchTour);
    const tools = { ...source, query: "service", stencils: ["generic.service"] };
    expect(met(workbenchTour, "tools", diagram, { tools }, { toolSurface: "closed" })).toBe(true);
    expect(met(workbenchTour, "tools", diagram, { tools }, { toolSurface: "library" })).toBe(false);
    expect(met(workbenchTour, "tools", diagram, { tools: { ...tools, stencils: [] } }, { toolSurface: "closed" })).toBe(
      false,
    );
    diagram.nodes.push({ id: "extra", stencil: "generic.service", label: "Extra", x: 0, y: 600 });
    expect(met(workbenchTour, "tools", diagram, { tools }, { toolSurface: "closed" })).toBe(false);
  });
  it("does not accept a different public gallery result, an unrelated library entry or a copy alone", () => {
    const diagram = start(libraryReuse);
    expect(met(libraryReuse, "gallery", diagram, { gallery: { ...source, feature: "partitions", slugs: [] } })).toBe(
      false,
    );
    expect(
      met(libraryReuse, "gallery", diagram, {
        gallery: { ...source, feature: "partitions", slugs: ["kafka-order-pipeline"] },
      }),
    ).toBe(true);
    const copied = { ...source, slug: "owned-status" };
    expect(met(libraryReuse, "keep", diagram, { copied })).toBe(false);
    expect(met(libraryReuse, "keep", diagram, { copied, library: { ...source, slugs: ["other"] } })).toBe(false);
    expect(met(libraryReuse, "keep", diagram, { copied, library: { ...source, slugs: [copied.slug] } })).toBe(true);
  });
  it("requires an actual redo and the restored name, not merely a second service", () => {
    const diagram = start(libraryReuse);
    diagram.nodes.push(
      { id: "original", stencil: "generic.service", label: "Service", x: 0, y: 300 },
      { id: "copy", stencil: "generic.service", label: "Almost", x: 300, y: 300 },
    );
    const history = { ...source, action: "redo" as const };
    expect(met(libraryReuse, "redo", diagram, { history })).toBe(false);
    diagram.nodes[3].label = "Status notifier";
    expect(met(libraryReuse, "redo", diagram, { history })).toBe(true);
    expect(met(libraryReuse, "redo", diagram, { history: { ...history, action: "undo" } })).toBe(false);
  });
  it("uses the real offline Compose parser/report and rejects a wrong stencil, name, connection and source report", async () => {
    const outcome = await importFiles([
      { name: "tutorial-status-compose.yaml", text: readFileSync("public/tutorial-status-compose.yaml", "utf8") },
    ]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok !== true) throw new Error("Fixture must import");
    expect(outcome.format).toBe("compose");
    expect(outcome.report?.source).toBe("tutorial-status-compose.yaml");
    expect(outcome.report?.guesses.length).toBeGreaterThan(0);
    expect(outcome.report?.inferred.length).toBeGreaterThan(0);
    expect(outcome.report?.unread.length).toBeGreaterThan(0);
    expect(outcome.report?.notDrawn.length).toBeGreaterThan(0);
    const diagram = outcome.diagram;
    const subjects = resolveSubjects(importAndReview, diagram);
    const worker = diagram.nodes.find((node) => node.id === subjects.worker)!;
    expect(worker.label).toBe("worker");
    expect(met(importAndReview, "correct", diagram)).toBe(false);
    worker.stencil = "service.python";
    worker.label = "Status worker";
    expect(met(importAndReview, "correct", diagram)).toBe(true);
    worker.label = "Status workers";
    expect(met(importAndReview, "correct", diagram)).toBe(false);
    expect(nearMiss(importAndReview.steps[3].check, { diagram }, resolveSubjects(importAndReview, diagram))).toEqual({
      expected: "Status worker",
      typed: "Status workers",
    });
    worker.label = "Status worker";
    const report = {
      ...source,
      source: outcome.report!.source,
      guesses: outcome.report!.guesses.length,
      unread: outcome.report!.unread.length,
      privacy: false,
    };
    expect(met(importAndReview, "privacy", diagram, { importReport: report })).toBe(true);
    expect(met(importAndReview, "privacy", diagram, { importReport: { ...report, source: "unrelated.yaml" } })).toBe(
      false,
    );
    diagram.edges = [];
    expect(met(importAndReview, "correct", diagram)).toBe(false);
  });
  it("keeps the named edge identity, Request and fixed source side through reconnect", () => {
    const diagram = start(dotsAndSides);
    const edge = {
      id: "original",
      from: "browser",
      to: "b",
      label: "Bookings query",
      kind: "sync" as const,
      sourceSide: "right" as const,
    };
    diagram.edges.push(edge);
    const subjects = { ...resolveSubjects(dotsAndSides, diagram), link: edge.id };
    const check = dotsAndSides.steps.find((step) => step.id === "reconnect")!.check;
    const view: SandboxView = { diagram, live: false, processed: () => 0 };
    expect(holds(check, view, subjects)).toBe(true);
    edge.label = "Other query";
    expect(holds(check, view, subjects)).toBe(false);
    edge.label = "Bookings query";
    diagram.edges[0] = { ...edge, kind: "async" };
    expect(holds(check, view, subjects)).toBe(false);
    diagram.edges[0] = { ...edge, sourceSide: undefined };
    expect(holds(check, view, subjects)).toBe(false);
  });
});
