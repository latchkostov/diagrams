import { afterEach, expect, it, vi } from "vitest";
import { state, type Catalog } from "../../i18n";
import { readKubernetes } from "./kubernetes";
import { catalogs } from "virtual:i18n/catalogs";
import { formatImportMessage } from "../ui/importMessages";
import { importTerraform } from "./pipeline";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
  vi.restoreAllMocks();
});

it("supporting resource summaries group diagnostic codes rather than translated strings", () => {
  const result = importTerraform([
    {
      name: "state.json",
      text: JSON.stringify({
        format_version: "1.0",
        terraform_version: "1.9.5",
        values: {
          root_module: {
            resources: [
              { type: "aws_sqs_queue", name: "jobs", values: { name: "jobs" } },
              { mode: "data", type: "aws_iam_policy_document", name: "policy", values: {} },
              { type: "unknown_type", name: "extra", values: {} },
            ],
          },
        },
      }),
    },
  ]);
  if (result.ok !== true || !result.report) throw new Error("expected imported report");
  expect(result.report.notes.map(formatImportMessage)).toContain(
    "2 supporting resources aren't drawn: data sources and other types",
  );
});

it("changing the UI language does not translate imported diagram subtitles", async () => {
  const text =
    "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  template:\n    spec:\n      containers:\n        - name: api\n          image: nginx\n          envFrom:\n            - configMapRef:\n                name: missing\n";
  const files = [{ name: "service.yaml", text }];
  const english = readKubernetes(files);
  expect(english.components.some((c) => c.sublabel === "not in these files")).toBe(true);
  const localized = (await import("../../i18n")).state;
  localized.l = "de";
  localized.c = { "not in these files": "nicht in diesen Dateien" };
  try {
    const reader = await import("./kubernetes");
    expect(reader.readKubernetes(files).components).toEqual(english.components);
  } finally {
    localized.l = "en";
    localized.c = undefined;
  }
});

it("a cached stencil resolver keeps its diagnostic neutral and presents it in the current language", async () => {
  const api = await import("../../i18n");
  const { imageStencil } = await import("./stencils");
  const cached = imageStencil("zookeeper");
  if (!cached || typeof cached === "string") throw new Error("expected skip diagnostic");
  expect(formatImportMessage(cached.skip)).toBe("part of Kafka");
  api.state.l = "de";
  api.state.c = (await catalogs.de()).default as Catalog;
  expect(imageStencil("zookeeper")).toEqual(cached);
  expect(formatImportMessage(cached.skip)).toBe("Teil von Kafka");
  api.state.l = "en";
  api.state.c = undefined;
});

it("retained graphs, reports and replay stay neutral when their reasons, notes and summary change language", async () => {
  const api = await import("../../i18n");
  const { readCompose: read } = await import("./compose");
  const { graphToDiagram: map } = await import("./map");
  const { formatImportMessage: present } = await import("../ui/importMessages");
  const files = [
    {
      name: "compose.yaml",
      text: "services:\n  api:\n    image: nginx\n    networks: [front, back]\n  db:\n    image: postgres\n    networks: [back]\n  web:\n    image: nginx\n    networks: [front]\n  cache:\n    image: redis\n    networks: [back]\n  worker:\n    image: nginx\n    networks: [back]\nvolumes:\n  data: {}\nnetworks:\n  front: {}\n  back: {}\n",
    },
  ];
  const graph = read(files);
  const saved = JSON.stringify(graph);
  const { diagram, report } = map(graph);
  const english = [
    present(report.summary),
    ...report.notes.map(present),
    ...report.notDrawn.map((line) => present(line.reason)),
  ];
  expect(report.notes.length).toBeGreaterThan(0);
  expect(report.notDrawn[0].reason).toEqual({ code: "importDetail.volume", args: [] });
  api.state.l = "ar";
  api.state.c = (await catalogs.ar()).default as Catalog;
  expect(read(files)).toEqual(graph);
  expect(map(graph).diagram).toEqual(diagram);
  const arabic = [
    present(report.summary),
    ...report.notes.map(present),
    ...report.notDrawn.map((line) => present(line.reason)),
  ];
  for (let i = 0; i < english.length; i++) expect(arabic[i]).not.toBe(english[i]);
  expect(JSON.stringify(graph)).toBe(saved);
  expect(map(graph).report).toEqual(report);
  api.state.l = "en";
  api.state.c = undefined;
});
