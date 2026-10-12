import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectFormat, importFiles, importText } from "../formats";
import { sniffInfra } from "../sniff";
import { interpolate } from "./compose";
import { parseUrl, readSetting } from "./settings";
import { TOO_MANY_ALIASES } from "./yaml";

// Everything an import reads is untrusted (docs/research/imports.md § Security and § Privacy): alias bombs,
// deep nesting, prototype keys, adversarial patterns, credentials in values, and never a network request.

const read = (path: string) => readFileSync(`tests/fixtures/imports/${path}`, "utf8");

afterEach(() => vi.restoreAllMocks());

describe("hostile input", () => {
  it("rejects the YAML alias bomb quickly, saying why", async () => {
    const started = performance.now();
    const outcome = await importText(read("hostile/yaml-bomb.yaml"), "yaml-bomb.yaml");
    expect(outcome).toEqual({ ok: false, error: TOO_MANY_ALIASES });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("never fetches anything: not a remote $ref, an include or an env file", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await importText(read("hostile/recursive-ref.asyncapi.yaml"), "recursive-ref.asyncapi.yaml");
    await importFiles([
      {
        name: "docker-compose.yml",
        text: "include: [https://example.com/c.yml]\nservices:\n  a:\n    image: x\n    env_file: https://example.com/.env\n",
      },
    ]);
    await importText(read("compose/docker-compose.yml"), "docker-compose.yml");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps __proto__ and constructor as plain names, and never pollutes prototypes", async () => {
    const outcome = await importText(
      `services:
  __proto__:
    image: redis
    environment: { polluted: "yes" }
  constructor:
    image: postgres
    environment:
      __proto__: x
  app:
    image: example/app
    environment:
      DB_HOST: constructor
      CACHE_HOST: __proto__
x-tag: !!js/function "function () { return 1 }"
`,
      "docker-compose.yml",
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(outcome.ok).toBe(true);
    if (outcome.ok !== true) return;
    expect(outcome.diagram.nodes.map((n) => n.label).sort()).toEqual(["__proto__", "app", "constructor"]);
  });

  it("refuses deep nesting and oversize text", async () => {
    let deep = "x: 1";
    for (let i = 0; i < 60; i++) deep = `a:\n${deep.replace(/^/gm, "  ")}`;
    const nested = await importText(`services:\n  s:\n    image: x\n    labels:\n${deep.replace(/^/gm, "      ")}\n`);
    expect(nested).toMatchObject({ ok: false, error: expect.stringMatching(/nested too deeply/) });
    const big = await importText(`services:\n${" ".repeat(8_000_001)}`);
    expect(big).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) });
  });

  it("explains YAML errors with a line number", async () => {
    const outcome = await importText("services:\n  a:\n    image: x\n  a:\n    image: y\n", "docker-compose.yml");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/isn't valid YAML \(line 4/) });
  });

  it("runs every pattern in linear time on adversarial input", () => {
    const inputs = [
      "a".repeat(100_000),
      "${".repeat(50_000),
      "$".repeat(100_000),
      ":".repeat(100_000),
      "http://" + "a.".repeat(50_000),
      "postgres://" + "@".repeat(100_000),
      "jdbc:" + "x://".repeat(25_000),
      "_".repeat(100_000) + "TOPIC",
      ",".repeat(100_000),
    ];
    for (const input of inputs) {
      const started = performance.now();
      readSetting(input, input);
      readSetting("DATABASE_URL", input);
      readSetting("KAFKA_BOOTSTRAP_SERVERS", input);
      readSetting("INPUT_TOPICS", input);
      parseUrl(input);
      interpolate(input);
      sniffInfra(input);
      detectFormat(input);
      expect(performance.now() - started, input.slice(0, 20)).toBeLessThan(250);
    }
  });
});

describe("values are never kept", () => {
  it("no value, password, connection string or userinfo reaches the diagram or the report", async () => {
    const credentials = `
name: leaky
services:
  api:
    image: example/api
    environment:
      DATABASE_URL: postgres://admin:hunter2-pass@db:5432/app?sslmode=require
      REDIS_URL: rediss://:s3cr3t-token@cache:6380
      STRIPE_URL: https://sk_live_abcdefghijklmnop@api.stripe.com/v1
      API_KEY: AKIAABCDEFGHIJKLMNOP
      ORDERS_TOPIC: orders
      "Password=hunter3-name;DB_URL": http://db:5432
  db: { image: postgres }
  cache: { image: redis }
`;
    for (const [name, text] of [
      ["docker-compose.yml", read("compose/docker-compose.yml")],
      ["leaky.yml", credentials],
    ]) {
      const outcome = await importText(text, name);
      expect(outcome.ok).toBe(true);
      if (outcome.ok !== true) continue;
      const out = JSON.stringify([outcome.diagram, outcome.report, outcome.warnings]);
      for (const secret of [
        "hunter2",
        "hunter3",
        "s3cr3t",
        "sk_live",
        "AKIA",
        "sslmode",
        "jdbc:",
        "postgres://",
        "redis://",
        "9092",
        "5432",
        "6379",
        "set it in .env",
        "orders_db_password.txt",
        "PLAINTEXT",
        "mainframe-gw",
        "production",
      ])
        expect(out, `${name}: ${secret}`).not.toContain(secret);
    }
  });
});

describe("format detection", () => {
  it("recognises compose, Kubernetes and AsyncAPI, and names the formats that aren't imported yet", async () => {
    expect(detectFormat("services:\n  a: {}\n")).toBe("compose");
    expect(detectFormat("version: '3'\nservices:\n  a: {}\n")).toBe("compose");
    expect(detectFormat('{"format":"diagrams/v1","nodes":[],"edges":[]}')).toBe("native");
    expect(detectFormat(read("asyncapi/orders-service.asyncapi.yaml"))).toBe("asyncapi");
    expect(detectFormat('{"asyncapi": "2.6.0", "info": {}}')).toBe("asyncapi");
    expect(detectFormat(read("k8s/orders-api.yaml"))).toBe("kubernetes");
    expect(detectFormat('{\n  "apiVersion": "v1",\n  "items": [],\n  "kind": "List"\n}')).toBe("kubernetes");
    const outcome = await importText('{"format_version":"1.2","terraform_version":"1.9.0"}', "plan.json");
    expect(outcome).toEqual({
      ok: false,
      error:
        "This looks like a Terraform plan. Importing those isn't supported yet; docker-compose files, Kubernetes manifests and AsyncAPI documents are.",
    });
    expect(await importText('apiVersion: v1\nkind: ConfigMap\ndata:\n  x: "{{ .Release.Name }}"\n')).toEqual({
      ok: false,
      error: "This looks like a Helm template ({{ .Values… }}). Run “helm template” and import its output.",
    });
    expect(sniffInfra('apiVersion: v1\nkind: ConfigMap\ndata:\n  x: "{{ .Values.x }}"\n')).toBe("helm");
    expect(sniffInfra('{"format_version":"1.2","terraform_version":"1.9.0"}')).toBe("terraform");
    expect(sniffInfra('{"asyncapi": "3.0.0"}')).toBe("asyncapi");
  });
});

describe("format detection keeps other formats intact", () => {
  it("a diagram file that mentions Helm or AsyncAPI is still a diagram file", async () => {
    const diagram = {
      format: "diagrams/v1",
      title: 'Helm {{ .Values.service }} and {{ include "x" }}',
      description: '"asyncapi": "3.0.0"',
      nodes: [{ id: "a", stencil: "generic.service", label: "{{ .Values.name }}", x: 0, y: 0 }],
      edges: [],
    };
    const text = JSON.stringify(diagram);
    expect(detectFormat(text)).toBe("native");
    const outcome = await importText(text, "helm.diagram.json");
    expect(outcome.ok).toBe(true);
  });

  it("only a Kubernetes manifest is read as a Helm template", () => {
    expect(sniffInfra("apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Values.name }}\n")).toBe("helm");
    expect(detectFormat('flowchart LR\n  a{{"include \\"x\\" .Values"}} --> b\n')).toBe("mermaid");
    expect(sniffInfra("services:\n  a:\n    image: x\n    labels: { t: '{{ .Values.x }}' }\n")).toBe("compose");
  });
});
