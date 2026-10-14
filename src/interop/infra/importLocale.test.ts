import { afterEach, expect, it, vi } from "vitest";
import { state } from "../../i18n";
import { readKubernetes } from "./kubernetes";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
  vi.restoreAllMocks();
});

it("changing the UI language does not translate imported diagram subtitles", async () => {
  const text =
    "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  template:\n    spec:\n      containers:\n        - name: api\n          image: nginx\n          envFrom:\n            - configMapRef:\n                name: missing\n";
  const files = [{ name: "service.yaml", text }];
  const english = readKubernetes(files);
  expect(english.components.some((c) => c.sublabel === "not in these files")).toBe(true);
  vi.resetModules();
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

it("a cached stencil resolver reads a report reason in the current language", async () => {
  const api = await import("../../i18n");
  const { imageStencil } = await import("./stencils");
  expect(imageStencil("zookeeper")).toEqual({ skip: "part of Kafka" });
  vi.spyOn(api, "t").mockReturnValue("Teil von Kafka");
  expect(imageStencil("zookeeper")).toEqual({ skip: "Teil von Kafka" });
});
