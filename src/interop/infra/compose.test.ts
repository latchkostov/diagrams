import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../../model/types";
import { relationOf } from "../../model/relations";
import { estimateCardSize } from "../../canvas/nodes/size";
import { detectFormat, importFiles, importText, type ImportOutcome } from "../formats";
import type { ImportReport } from "./graph";
import { importCompose } from "./pipeline";
import { interpolate, readCompose } from "./compose";

// docker-compose import against the self-written fixture (tests/fixtures/imports/compose), as
// docs/research/imports.md § Mapping: docker-compose describes it.

const FIXTURE = readFileSync("tests/fixtures/imports/compose/docker-compose.yml", "utf8");

function ok(outcome: ImportOutcome): { diagram: DiagramFile; report: ImportReport } {
  if (outcome.ok !== true) throw new Error(`import failed: ${JSON.stringify(outcome)}`);
  if (!outcome.report) throw new Error("no report");
  return { diagram: outcome.diagram, report: outcome.report };
}
const fixture = () => ok(importCompose([{ name: "docker-compose.yml", text: FIXTURE }]));
const edge = (d: DiagramFile, from: string, to: string) => d.edges.find((e) => e.from === from && e.to === to);
const relationBetween = (d: DiagramFile, from: string, to: string) => {
  const e = edge(d, from, to);
  return e && (relationOf(e) === "flow" ? (e.kind === "sync" ? "request" : "message") : relationOf(e));
};

describe("docker-compose import: the shop fixture", () => {
  it("is recognised as compose and imports through importText", async () => {
    expect(detectFormat(FIXTURE, "docker-compose.yml")).toBe("compose");
    const outcome = await importText(FIXTURE, "docker-compose.yml");
    expect(outcome.ok).toBe(true);
    if (outcome.ok === true) expect(outcome.format).toBe("compose");
  });

  it("draws 10 services, plus Users, Compose secrets, two topics and one External API", () => {
    const { diagram } = fixture();
    expect(diagram.title).toBe("shop");
    const byId = Object.fromEntries(diagram.nodes.map((n) => [n.id, n]));
    expect(Object.keys(byId).sort()).toEqual(
      [
        "gateway",
        "storefront",
        "orders-api",
        "payments-worker",
        "shipping-worker",
        "kafka",
        "schema-registry",
        "postgres",
        "redis",
        "legacy-adapter",
        "users",
        "compose-secrets",
        "topic-orders.placed.v1",
        "topic-payments.completed.v1",
        "ext-api.payments.example.com",
      ].sort(),
    );
    expect(byId.gateway.stencil).toBe("nginx");
    expect(byId.postgres.stencil).toBe("postgres");
    expect(byId.redis.stencil).toBe("redis.cache");
    expect(byId.kafka.stencil).toBe("kafka.cluster");
    expect(byId["schema-registry"].stencil).toBe("kafka.schema-registry");
    expect(byId["orders-api"].stencil).toBe("service.java");
    expect(byId.storefront.stencil).toBe("service.node");
    expect(byId["legacy-adapter"].stencil).toBe("generic.service");
    expect(byId["payments-worker"].stencil).toBe("generic.service");
    expect(byId.users.stencil).toBe("client.user");
    expect(byId["compose-secrets"].stencil).toBe("generic.secret-store");
    expect(byId["topic-orders.placed.v1"].stencil).toBe("kafka.topic");
    expect(byId["ext-api.payments.example.com"]).toMatchObject({
      stencil: "generic.external-api",
      label: "api.payments.example.com",
    });
    // Subtitles keep the evidence; replicas come from deploy.replicas.
    expect(byId["legacy-adapter"].sublabel).toBe("legacy-adapter:1.4");
    expect(byId["orders-api"].sublabel).toBe("orders-api:dev");
    expect(byId["payments-worker"].props).toEqual({ replicas: 3 });
  });

  it("finds connections in settings, and lets flows win over depends_on", () => {
    const { diagram: d } = fixture();
    expect(relationBetween(d, "users", "gateway")).toBe("request");
    // A reverse proxy's depends_on names its upstreams: requests, not Depends on.
    expect(relationBetween(d, "gateway", "storefront")).toBe("request");
    expect(relationBetween(d, "gateway", "orders-api")).toBe("request");
    expect(relationBetween(d, "storefront", "orders-api")).toBe("request");
    expect(relationBetween(d, "orders-api", "postgres")).toBe("request");
    expect(relationBetween(d, "orders-api", "redis")).toBe("request");
    expect(relationBetween(d, "shipping-worker", "postgres")).toBe("request");
    expect(relationBetween(d, "orders-api", "schema-registry")).toBe("depends");
    expect(relationBetween(d, "payments-worker", "schema-registry")).toBe("depends");
    expect(relationBetween(d, "payments-worker", "ext-api.payments.example.com")).toBe("request");
    // Topics: payments-worker reads one (group payments) and writes the other; orders-api writes one (a guess).
    expect(relationBetween(d, "topic-orders.placed.v1", "payments-worker")).toBe("message");
    expect(edge(d, "topic-orders.placed.v1", "payments-worker")?.props).toEqual({ group: "payments" });
    expect(relationBetween(d, "payments-worker", "topic-payments.completed.v1")).toBe("message");
    expect(relationBetween(d, "orders-api", "topic-orders.placed.v1")).toBe("message");
    // Brokers but no topic: Depends on the cluster. With topics, depends_on kafka adds nothing.
    expect(relationBetween(d, "shipping-worker", "kafka")).toBe("depends");
    expect(edge(d, "orders-api", "kafka")).toBeUndefined();
    expect(edge(d, "payments-worker", "kafka")).toBeUndefined();
    // depends_on postgres is already a request: one edge, not two.
    expect(d.edges.filter((e) => e.from === "orders-api" && e.to === "postgres")).toHaveLength(1);
    // Secrets: the service's secrets list and *_FILE=/run/secrets/…
    expect(relationBetween(d, "orders-api", "compose-secrets")).toBe("secret");
    expect(relationBetween(d, "postgres", "compose-secrets")).toBe("secret");
    // legacy-adapter's UPSTREAM=tcp://… matches no rule: nothing drawn for it.
    expect(d.edges.filter((e) => e.from === "legacy-adapter" || e.to === "legacy-adapter")).toEqual([]);
    expect(d.edges).toHaveLength(17);
  });

  it("makes the two networks boundaries, and says where a service on both went", () => {
    const { diagram: d, report } = fixture();
    expect(d.groups?.map((g) => g.label)).toEqual(["frontend", "backend"]);
    const groupOf = (id: string) => d.groups?.find((g) => g.id === d.nodes.find((n) => n.id === id)?.group)?.label;
    expect(groupOf("gateway")).toBe("frontend");
    expect(groupOf("storefront")).toBe("frontend");
    expect(groupOf("orders-api")).toBe("backend");
    expect(groupOf("topic-orders.placed.v1")).toBe("backend");
    expect(groupOf("users")).toBeUndefined();
    expect(groupOf("compose-secrets")).toBeUndefined();
    expect(report.notes).toEqual(["orders-api is on frontend and backend; shown in backend"]);
  });

  it("reports guesses with chips, settings with their variable, and what wasn't drawn", () => {
    const { report } = fixture();
    expect(report).toMatchObject({
      format: "docker-compose",
      title: "shop",
      nodes: 15,
      connections: 17,
      boundaries: 2,
    });
    expect(report.guesses.map((g) => [g.nodeId, g.stencil])).toEqual([
      ["storefront", "service.node"],
      ["legacy-adapter", "generic.service"],
    ]);
    expect(report.guesses[0].alternatives).toContain("client.browser");
    expect(report.guesses[1].alternatives[0]).toBe("generic.external-api");
    expect(report.guesses[0].evidence).toBe("storefront:4.2.0 · NODE_ENV");
    const found = Object.fromEntries(report.inferred.map((c) => [`${c.from} → ${c.to}`, c]));
    expect(found["orders-api → postgres"].evidence).toBe("SPRING_DATASOURCE_URL");
    expect(found["orders.placed.v1 → payments-worker"]).toMatchObject({ evidence: "INPUT_TOPIC", note: "reads" });
    expect(found["orders-api → orders.placed.v1"]).toMatchObject({ evidence: "ORDERS_TOPIC", guess: true });
    expect(found["shipping-worker → kafka"].note).toBe("couldn't tell what it reads or writes");
    expect(found["shipping-worker → postgres"].evidence).toBe("DATABASE_URL");
    expect(report.notDrawn).toEqual([
      { name: "pgdata", reason: "volume" },
      { name: "kafka-ui", reason: "only in profile “debug”" },
    ]);
    expect(report.unread).toEqual([]);
  });

  it("lays out without overlaps, members inside their boundaries", () => {
    const { diagram: d } = fixture();
    const boxes = d.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, ...estimateCardSize(n.label, n.sublabel) }));
    const hit = (a: (typeof boxes)[0], b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(hit(boxes[i], boxes[j]), `${boxes[i].id} / ${boxes[j].id}`).toBe(false);
    for (const g of d.groups ?? []) {
      for (const b of boxes) {
        const member = d.nodes.find((n) => n.id === b.id)?.group === g.id;
        const inside = b.x >= g.x && b.y >= g.y && b.x + b.width <= g.x + g.width && b.y + b.height <= g.y + g.height;
        if (member) expect(inside, `${b.id} in ${g.label}`).toBe(true);
        else expect(hit(b, g), `${b.id} outside ${g.label}`).toBe(false);
      }
    }
    const [a, b] = d.groups!;
    expect(hit(a, b)).toBe(false);
    // Left to right: Users, then the frontend, then the backend.
    expect(d.nodes.find((n) => n.id === "users")!.x).toBeLessThan(a.x);
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
  });
});

describe("docker-compose import: Compose features", () => {
  const compose = (text: string, name = "docker-compose.yml") => ok(importCompose([{ name, text }]));

  it("interpolates with the file's own defaults only", () => {
    expect(interpolate("${HOST:-db}:5432")).toBe("db:5432");
    expect(interpolate("${HOST-db}")).toBe("db");
    expect(interpolate("$$HOME")).toBe("$HOME");
    expect(interpolate("${SECRET}")).not.toContain("SECRET");
    expect(interpolate("x$NAME")).not.toContain("NAME");
    expect(interpolate("${UNCLOSED")).not.toContain("UNCLOSED");
  });

  it("resolves extends in the same file, links, aliases and env defaults", () => {
    const { diagram: d } = compose(`
services:
  base:
    image: example/app:1
    profiles: [never]
  api:
    extends: base
    profiles: []
    environment:
      - CACHE_HOST=\${CACHE:-cache}
      - DB_ADDR=primary:5432
  cache:
    image: memcached
  db:
    image: mysql:8
    networks:
      default:
        aliases: [primary]
`);
    expect(d.nodes.find((n) => n.id === "api")?.sublabel).toBe("app:1");
    expect(d.nodes.find((n) => n.id === "db")?.stencil).toBe("mysql");
    expect(relationBetween(d, "api", "cache")).toBe("request");
    expect(relationBetween(d, "api", "db")).toBe("request");
  });

  it("merges an override file, reads an opened .env file, and lists what it couldn't read", async () => {
    const base = `
services:
  web:
    image: nginx
    env_file: [./web.env, ./missing.env]
    ports: ["8080:80"]
  api:
    image: example/api
include:
  - ./other-compose.yml
`;
    const override = `
services:
  api:
    environment:
      PAYMENTS_URL: https://api.stripe.com/v1
    configs: [api-settings]
`;
    const outcome = await importFiles([
      { name: "docker-compose.override.yml", text: override },
      { name: "docker-compose.yml", text: base },
      { name: "web.env", text: "UPSTREAM_URL=http://api:8080\n" },
    ]);
    const { diagram: d, report } = ok(outcome);
    expect(report.source).toBe("docker-compose.override.yml, docker-compose.yml");
    expect(relationBetween(d, "web", "api")).toBe("request");
    expect(relationBetween(d, "users", "web")).toBe("request");
    const stripe = d.nodes.find((n) => n.label === "api.stripe.com");
    expect(stripe?.stencil).toBe("stripe");
    const config = d.edges.find((e) => relationOf(e) === "config");
    expect(config?.props?.settings).toEqual([{ key: "api-settings" }]);
    expect(report.unread).toEqual([
      { name: "include ./other-compose.yml", reason: "not among the files you opened" },
      { name: "env_file ./missing.env", reason: "not among the files you opened" },
    ]);
  });

  it("doesn't draw developer tools, Zookeeper or LocalStack, and says why", () => {
    const { report } = compose(`
services:
  app: { image: example/app }
  zk: { image: confluentinc/cp-zookeeper:7.7.1 }
  ui: { image: provectuslabs/kafka-ui }
  aws: { image: localstack/localstack }
`);
    expect(report.notDrawn).toEqual([
      { name: "zk", reason: "part of Kafka" },
      { name: "ui", reason: "developer tool" },
      { name: "aws", reason: "emulates AWS; its services aren't known from the image" },
    ]);
  });

  it("keeps one network as no boundary, and draws nothing for an empty file", () => {
    const { diagram } = compose("services:\n  a: { image: redis }\n  b: { image: postgres }\n");
    expect(diagram.groups ?? []).toEqual([]);
    expect(() => readCompose([{ name: "x.yml", text: "services: {}\n" }])).toThrow(/no services/);
  });
});
