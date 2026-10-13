import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramGroup, DiagramNode } from "../model/types";
import { applyOps } from "../ai";
import { relationOf } from "../model/relations";
import { catalog } from "../stencils/catalog";
import { inferRelation } from "../stencils/relations";
import { preservesDelivery } from "../test/delivery";
import { runChecks } from "./run";
import { agentReport } from "./report";

// The two batch 4 rules (secret-identity, schema-registry) on tiny diagrams: what fires, what doesn't, the edge
// cases, and that each fix clears its finding, only adds, and leaves every message where it was.
// docs/research/architecture-checks.md, "Batch 4".

let x = 0;
const node = (id: string, stencil: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({
  id,
  stencil,
  label: id,
  x: (x += 300),
  y: 0,
  ...extra,
});
const msg = (from: string, to: string): DiagramEdge => ({ id: `${from}-${to}`, from, to, kind: "async" });
const req = (from: string, to: string): DiagramEdge => ({ id: `${from}-${to}`, from, to, kind: "sync" });
const dep = (from: string, to: string, relation: DiagramEdge["relation"], label?: string): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  relation,
  ...(label ? { label } : {}),
});
const box = (id: string, tone: DiagramGroup["tone"]): DiagramGroup => ({
  id,
  label: id,
  tone,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});
/** Sizes each boundary around its members, as a drawn one is. */
function enclose(d: DiagramFile): DiagramFile {
  for (const g of d.groups ?? []) {
    const members = d.nodes.filter((n) => n.group === g.id);
    if (!members.length) continue;
    const x0 = Math.min(...members.map((n) => n.x)) - 40;
    const y0 = Math.min(...members.map((n) => n.y)) - 60;
    Object.assign(g, {
      x: x0,
      y: y0,
      width: Math.max(...members.map((n) => n.x)) + 280 - x0,
      height: Math.max(...members.map((n) => n.y)) + 140 - y0,
    });
  }
  return d;
}
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[], extra: Partial<DiagramFile> = {}): DiagramFile => ({
  format: "diagrams/v1",
  title: "t",
  nodes,
  edges,
  ...extra,
});
const of = (d: DiagramFile, rule: "secret-identity" | "schema-registry") => runChecks(d, { rules: [rule] }).findings;
const ids = (d: DiagramFile, rule: "secret-identity" | "schema-registry") =>
  of(d, rule).map((f) => `${f.severity}:${f.id}`);

/** Applies the finding's fix (or an option, by its words), checks it only added, and returns the diagram after. */
function fixed(d: DiagramFile, rule: "secret-identity" | "schema-registry", option?: string): DiagramFile {
  const [finding] = of(d, rule);
  expect(finding, rule).toBeDefined();
  const ops = option ? finding.fix!.options!.find((o) => o.label === option)!.ops : finding.fix!.ops!;
  const result = applyOps(d, ops);
  expect(result.errors).toEqual([]);
  // It never changes or removes what was there: every node, connection and boundary is as it was.
  const after = result.diagram;
  for (const n of d.nodes) expect(after.nodes.find((m) => m.id === n.id)).toEqual(n);
  for (const e of d.edges) expect(after.edges.find((f) => f.id === e.id)).toEqual(e);
  // Boundaries keep their names, tones and members. One that takes a new node refits around its members, as any
  // add into a boundary does, so it still holds every one of them.
  const plain = (g: DiagramGroup) => ({ id: g.id, label: g.label, tone: g.tone });
  expect((after.groups ?? []).map(plain)).toEqual((d.groups ?? []).map(plain));
  for (const g of after.groups ?? [])
    for (const n of after.nodes.filter((m) => m.group === g.id))
      expect(n.x >= g.x && n.y >= g.y && n.x < g.x + g.width && n.y < g.y + g.height, `${n.id} in ${g.id}`).toBe(true);
  // What it adds carries no traffic: every new connection is a dependency.
  const added = after.edges.filter((e) => !d.edges.some((f) => f.id === e.id));
  expect(added.length).toBeGreaterThan(0);
  for (const e of added) expect(relationOf(e)).not.toBe("flow");
  return after;
}
const newNodes = (before: DiagramFile, after: DiagramFile) =>
  after.nodes.filter((n) => !before.nodes.some((m) => m.id === n.id));

describe("secret-identity", () => {
  /** A storefront's order API and its confirmation function, both on Azure, read Key Vault. */
  const azure = () =>
    diagram(
      [
        node("web", "client.browser"),
        node("api", "azure.container-apps", { label: "Orders API" }),
        node("bus", "azure.service-bus.topic", { label: "orders" }),
        node("fn", "azure.functions", { label: "Confirmation" }),
        node("db", "azure.cosmos-db"),
        node("kv", "azure.key-vault", { label: "orders-kv" }),
      ],
      [
        req("web", "api"),
        msg("api", "bus"),
        msg("bus", "fn"),
        req("fn", "db"),
        dep("api", "kv", "secret"),
        dep("fn", "kv", "secret"),
      ],
    );

  it("raises one suggestion per diagram, naming every service, with a managed identity as the fix", () => {
    const [finding, ...rest] = of(azure(), "secret-identity");
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      id: "secret-identity:kv",
      severity: "suggestion",
      target: "kv",
      elements: ["kv", "api", "fn"],
      title: "2 services read secrets without an identity",
    });
    expect(finding.message).toBe(
      "Orders API and Confirmation read secrets from orders-kv, but the diagram doesn't say what they sign in as. With a managed identity, they get in with no stored credential to leak or rotate.",
    );
    expect(finding.fix).toEqual({
      label: "Add a managed identity",
      ops: [
        {
          op: "add_node",
          kind: "azure.managed-identity",
          label: "Managed Identity",
          sublabel: "workload identity",
          key: "new-identity-1",
        },
        { op: "connect", from: "api", to: "new-identity-1", relation: "identity" },
        { op: "connect", from: "fn", to: "new-identity-1", relation: "identity" },
      ],
      options: [
        {
          label: "Add a managed identity for each service",
          short: "One for each service",
          ops: [
            {
              op: "add_node",
              kind: "azure.managed-identity",
              label: "Orders API identity",
              sublabel: "workload identity",
              key: "new-identity-1",
            },
            { op: "connect", from: "api", to: "new-identity-1", relation: "identity" },
            {
              op: "add_node",
              kind: "azure.managed-identity",
              label: "Confirmation identity",
              sublabel: "workload identity",
              key: "new-identity-2",
            },
            { op: "connect", from: "fn", to: "new-identity-2", relation: "identity" },
          ],
        },
      ],
    });
  });

  it("the fix adds one shared identity; the chip one for each service; both clear the finding", () => {
    const d = azure();
    const shared = fixed(d, "secret-identity");
    const [identity] = newNodes(d, shared);
    expect(identity).toMatchObject({ stencil: "azure.managed-identity", label: "Managed Identity" });
    expect(shared.edges.filter((e) => e.to === identity.id).map((e) => [e.from, relationOf(e)])).toEqual([
      ["api", "identity"],
      ["fn", "identity"],
    ]);
    expect(ids(shared, "secret-identity")).toEqual([]);
    const each = fixed(d, "secret-identity", "Add a managed identity for each service");
    expect(newNodes(d, each).map((n) => n.label)).toEqual(["Orders API identity", "Confirmation identity"]);
    expect(ids(each, "secret-identity")).toEqual([]);
  });

  it("a fix changes no traffic: a seeded run delivers the same to every node, for the button and the chip", () => {
    expect(preservesDelivery(azure(), "secret-identity")).toBe(2);
  });

  it("a new identity goes in the boundary its services share; the registry in its topics'", () => {
    const d = azure();
    d.groups = [box("az", "azure")];
    for (const n of d.nodes) if (n.id !== "web") n.group = "az";
    enclose(d);
    const shared = fixed(d, "secret-identity");
    expect(newNodes(d, shared)[0].group).toBe("az");
    // Services in different boundaries: each identity of its own goes with its service; the shared one in neither.
    d.groups.push(box("fns", "azure"));
    d.nodes.find((n) => n.id === "fn")!.group = "fns";
    enclose(d);
    expect(newNodes(d, fixed(d, "secret-identity"))[0].group).toBeUndefined();
    const each = fixed(d, "secret-identity", "Add a managed identity for each service");
    expect(newNodes(d, each).map((n) => n.group)).toEqual(["az", "fns"]);

    const k = diagram(
      [
        node("p", "service.java"),
        node("t", "kafka.topic", { sublabel: "Avro", group: "kafka" }),
        node("c", "service.go"),
      ],
      [msg("p", "t"), msg("t", "c")],
      { groups: [box("kafka", "neutral")] },
    );
    enclose(k);
    expect(newNodes(k, fixed(k, "schema-registry"))[0]).toMatchObject({ group: "kafka", sublabel: "schemas" });
  });

  it("one service: its own name, and no chip", () => {
    const d = azure();
    d.edges = d.edges.filter((e) => e.id !== "fn-kv");
    const [finding] = of(d, "secret-identity");
    expect(finding.title).toBe("Orders API reads secrets without an identity");
    expect(finding.message).toMatch(
      /^Orders API reads secrets from orders-kv, but the diagram doesn't say what it signs in as\./,
    );
    expect(finding.fix?.options).toBeUndefined();
    expect(newNodes(d, fixed(d, "secret-identity")).map((n) => n.label)).toEqual(["Orders API identity"]);
  });

  it("a service that already has an identity, any identity, doesn't count", () => {
    const d = azure();
    d.nodes.push(node("entra", "entra-id"));
    d.edges.push(dep("fn", "entra", "identity"));
    expect(of(d, "secret-identity")[0].title).toBe("Orders API reads secrets without an identity");
    d.edges.push(dep("api", "entra", "identity"));
    expect(ids(d, "secret-identity")).toEqual([]);
  });

  it("names the identity by the service's cloud, its boundary's, else the store's", () => {
    const kind = (d: DiagramFile) => of(d, "secret-identity")[0]?.fix?.ops?.[0];
    // The store's cloud, for a service on none.
    expect(
      kind(diagram([node("svc", "service.go"), node("sm", "aws.secrets-manager")], [dep("svc", "sm", "secret")])),
    ).toMatchObject({ kind: "aws.iam-role" });
    expect(
      of(
        diagram([node("svc", "service.go"), node("sm", "aws.secrets-manager")], [dep("svc", "sm", "secret")]),
        "secret-identity",
      )[0].fix?.label,
    ).toBe("Add an IAM role");
    const gcp = diagram([node("svc", "service.go"), node("gsm", "gcp.secret-manager")], [dep("svc", "gsm", "secret")]);
    expect(kind(gcp)).toMatchObject({ kind: "gcp.service-account" });
    expect(of(gcp, "secret-identity")[0].fix?.label).toBe("Add a service account");
    // HashiCorp Vault: the service's own cloud, or its boundary's.
    expect(
      kind(diagram([node("fn", "aws.lambda"), node("vault", "vault")], [dep("fn", "vault", "secret")])),
    ).toMatchObject({ kind: "aws.iam-role" });
    expect(
      kind(
        diagram([node("svc", "service.go", { group: "g" }), node("vault", "vault")], [dep("svc", "vault", "secret")], {
          groups: [box("g", "gcp")],
        }),
      ),
    ).toMatchObject({ kind: "gcp.service-account" });
  });

  it("HashiCorp Vault or a generic store, read by a service on no cloud, doesn't fire", () => {
    // It signs in with Vault's own methods (Kubernetes, AppRole), which the diagram has no node for.
    for (const store of ["vault", "generic.secret-store"]) {
      const d = diagram([node("svc", "service.go", { group: "k8s" }), node("s", store)], [dep("svc", "s", "secret")], {
        groups: [box("k8s", "k8s")],
      });
      expect(ids(d, "secret-identity"), store).toEqual([]);
    }
  });

  it("services on two clouds: one finding, an identity of each kind", () => {
    const d = diagram(
      [
        node("fn", "azure.functions"),
        node("kv", "azure.key-vault"),
        node("l", "aws.lambda"),
        node("sm", "aws.secrets-manager"),
      ],
      [dep("fn", "kv", "secret"), dep("l", "sm", "secret")],
    );
    const [finding, ...rest] = of(d, "secret-identity");
    expect(rest).toEqual([]);
    expect(finding.elements).toEqual(["kv", "fn", "l", "sm"]);
    expect(finding.message).toMatch(/read secrets from kv and sm.*With a workload identity/);
    expect(finding.fix?.label).toBe("Add workload identities");
    const after = fixed(d, "secret-identity");
    expect(newNodes(d, after).map((n) => n.stencil)).toEqual(["azure.managed-identity", "aws.iam-role"]);
  });

  it("config stores, Kubernetes Secrets, people and flows don't count", () => {
    // App Configuration's secret dependency is a Key Vault reference its reader resolves.
    expect(
      ids(
        diagram([node("cfg", "azure.app-config"), node("kv", "azure.key-vault")], [dep("cfg", "kv", "secret")]),
        "secret-identity",
      ),
    ).toEqual([]);
    // The kubelet mounts a Kubernetes Secret: a pod never signs in to read one.
    expect(
      ids(
        diagram([node("pod", "k8s.deployment", { group: "a" }), node("s", "k8s.secret")], [dep("pod", "s", "secret")], {
          groups: [box("a", "azure")],
        }),
        "secret-identity",
      ),
    ).toEqual([]);
    // A person signs in as themselves.
    expect(
      ids(
        diagram([node("oncall", "client.team"), node("kv", "azure.key-vault")], [dep("oncall", "kv", "secret")]),
        "secret-identity",
      ),
    ).toEqual([]);
    // A flow to the vault isn't a Secret dependency.
    expect(
      ids(
        diagram([node("fn", "azure.functions"), node("kv", "azure.key-vault")], [msg("fn", "kv")]),
        "secret-identity",
      ),
    ).toEqual([]);
  });

  it("words that already say how it signs in keep it quiet: on the vault, the service or the dependency", () => {
    const d = () =>
      diagram([node("fn", "azure.functions"), node("kv", "azure.key-vault")], [dep("fn", "kv", "secret")]);
    const onVault = d();
    onVault.nodes[1].sublabel = "ERP credentials · managed identity";
    const onService = d();
    onService.nodes[0].sublabel = "Workload identity";
    const onEdge = d();
    onEdge.edges[0].label = "as its IAM role";
    for (const said of [onVault, onService, onEdge]) expect(ids(said, "secret-identity")).toEqual([]);
    expect(ids(d(), "secret-identity")).toEqual(["suggestion:secret-identity:kv"]);
  });

  it("the target is the first vault in the file, so moving things keeps an ignore", () => {
    const d = diagram(
      [node("fn", "azure.functions"), node("kv2", "azure.key-vault"), node("kv1", "azure.key-vault")],
      [dep("fn", "kv1", "secret"), dep("fn", "kv2", "secret")],
    );
    expect(of(d, "secret-identity")[0].target).toBe("kv2");
    d.nodes[1].x = 5_000;
    expect(of(d, "secret-identity")[0].target).toBe("kv2");
  });

  it("stays within one edit batch: too many services for one step give no fix, and the row says so", () => {
    const many = (n: number) =>
      diagram(
        [node("kv", "azure.key-vault"), ...Array.from({ length: n }, (_, i) => node(`fn${i}`, "azure.functions"))],
        Array.from({ length: n }, (_, i) => dep(`fn${i}`, "kv", "secret")),
      );
    // 60: the shared identity fits (61 ops), one each doesn't (120), so no chip.
    const [sixty] = of(many(60), "secret-identity");
    expect(sixty.fix?.ops).toHaveLength(61);
    expect(sixty.fix?.options).toBeUndefined();
    expect(applyOps(many(60), sixty.fix!.ops!).errors).toEqual([]);
    // 120: nothing fits.
    const [lots] = of(many(120), "secret-identity");
    expect(lots.title).toBe("120 services read secrets without an identity");
    expect(lots.fix).toBeUndefined();
    expect(lots.message).toMatch(/too big a change for one step/);
    // An id too long for an edit op's reference.
    const long = many(1);
    const id = "f".repeat(201);
    long.nodes[1].id = id;
    long.edges[0] = dep(id, "kv", "secret");
    expect(of(long, "secret-identity")[0].fix).toBeUndefined();
  });

  it("agents get the fix and the chip as edit ops, within the reply's budget", () => {
    const report = agentReport(runChecks(azure(), { rules: ["secret-identity"] }));
    expect(JSON.stringify(report).length).toBeLessThanOrEqual(1500);
    const [f] = report.findings;
    expect(f.fix && "ops" in f.fix && f.fix.others?.[0].label).toBe("Add a managed identity for each service");
  });
});

describe("the Google Cloud service account stencil", () => {
  const icons = import.meta.glob("../stencils/icons/*.svg", { query: "?raw", import: "default", eager: true });

  it("is in the catalogue with its icon, is an identity, and is what Google Cloud services get", () => {
    const stencil = catalog.find((s) => s.id === "gcp.service-account");
    expect(stencil).toMatchObject({ label: "Service Account", vendor: "Google Cloud", simRole: "none" });
    expect(icons[`../stencils/icons/${stencil!.icon}.svg`]).toMatch(/^<svg/);
    // A connection drawn to it is an Identity dependency, as the fix's is.
    expect(inferRelation("gcp.cloud-run", "gcp.service-account")).toBe("identity");
    const d = diagram([node("run", "gcp.cloud-run"), node("sm", "gcp.secret-manager")], [dep("run", "sm", "secret")]);
    const after = fixed(d, "secret-identity");
    expect(newNodes(d, after)[0]).toMatchObject({ stencil: "gcp.service-account", label: "run identity" });
  });
});

describe("schema-registry", () => {
  /** A checkout writes Avro orders to Kafka; shipping and billing read them. */
  const avro = (props: Record<string, unknown> = { contentType: "application/vnd.apache.avro+json" }) =>
    diagram(
      [
        node("web", "client.browser"),
        node("orders", "service.java", { label: "Order service" }),
        node("topic", "kafka.topic", { label: "orders.placed.v1", props }),
        node("ship", "service.go", { label: "Shipping" }),
        node("bill", "service.node", { label: "Billing" }),
        node("db", "postgres"),
      ],
      [req("web", "orders"), msg("orders", "topic"), msg("topic", "ship"), msg("topic", "bill"), req("bill", "db")],
    );

  it("warns once for Avro on Kafka with no registry, naming who writes and reads it", () => {
    const [finding, ...rest] = of(avro(), "schema-registry");
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      id: "schema-registry:topic",
      severity: "warning",
      target: "topic",
      elements: ["topic", "orders", "ship", "bill"],
      title: "Avro on orders.placed.v1, but no schema registry",
    });
    expect(finding.message).toBe(
      "orders.placed.v1 carries Avro; Order service writes it and Shipping and Billing read it. With no schema registry, consumers can't look up the schema a record was written with, and nothing checks that a new one is compatible.",
    );
    expect(finding.fix).toEqual({
      label: "Add Schema Registry",
      ops: [
        {
          op: "add_node",
          kind: "kafka.schema-registry",
          label: "Schema Registry",
          sublabel: "schemas",
          key: "new-schema-registry",
        },
        { op: "connect", from: "orders", to: "new-schema-registry", relation: "depends" },
        { op: "connect", from: "ship", to: "new-schema-registry", relation: "depends" },
        { op: "connect", from: "bill", to: "new-schema-registry", relation: "depends" },
      ],
    });
  });

  it("the fix adds the registry, a Depends on from each client, and clears the warning", () => {
    const d = avro();
    const after = fixed(d, "schema-registry");
    const [registry] = newNodes(d, after);
    expect(registry.stencil).toBe("kafka.schema-registry");
    expect(after.edges.filter((e) => e.to === registry.id).map((e) => [e.from, relationOf(e)])).toEqual([
      ["orders", "depends"],
      ["ship", "depends"],
      ["bill", "depends"],
    ]);
    expect(ids(after, "schema-registry")).toEqual([]);
  });

  it("a fix changes no traffic: a seeded run delivers the same to every node", () => {
    expect(preservesDelivery(avro(), "schema-registry")).toBe(1);
  });

  it("reads the format from the content type, else the label; Protobuf too; MSK and Confluent Cloud too", () => {
    expect(of(avro({ contentType: "application/x-protobuf" }), "schema-registry")[0].title).toBe(
      "Protobuf on orders.placed.v1, but no schema registry",
    );
    const labelled = avro({});
    labelled.nodes[2].sublabel = "Avro · key: orderId";
    expect(ids(labelled, "schema-registry")).toEqual(["warning:schema-registry:topic"]);
    for (const stencil of ["aws.msk", "confluent.cloud"]) {
      const d = avro();
      d.nodes[2].stencil = stencil;
      expect(ids(d, "schema-registry"), stencil).toEqual(["warning:schema-registry:topic"]);
    }
  });

  it("several topics: one warning, every topic and client, one registry", () => {
    const d = avro();
    d.nodes.push(
      node("pay", "kafka.topic", { label: "payments.v1", sublabel: "Protobuf" }),
      node("ledger", "service.go"),
    );
    d.edges.push(msg("bill", "pay"), msg("pay", "ledger"));
    const [finding] = of(d, "schema-registry");
    expect(finding.title).toBe("Avro and Protobuf on orders.placed.v1 and 1 more topic, but no schema registry");
    expect(finding.elements).toEqual(["topic", "pay", "orders", "bill", "ship", "ledger"]);
    expect(newNodes(d, fixed(d, "schema-registry"))).toHaveLength(1);
  });

  it("a registry drawn any way keeps it quiet, connected or not", () => {
    const withStencil = avro();
    withStencil.nodes.push(node("sr", "kafka.schema-registry"));
    const apicurio = avro();
    apicurio.nodes.push(node("reg", "generic.service", { label: "Apicurio Registry" }));
    const glue = avro();
    glue.nodes.push(node("glue", "generic.service", { label: "Schemas", sublabel: "Glue Schema Registry" }));
    for (const d of [withStencil, apicurio, glue]) expect(ids(d, "schema-registry")).toEqual([]);
  });

  it("words saying the registry is missing don't count as one, on the topic or anywhere else", () => {
    const onTopic = avro({});
    onTopic.nodes[2].sublabel = "Avro, no schema registry";
    expect(ids(onTopic, "schema-registry")).toEqual(["warning:schema-registry:topic"]);
    for (const words of [
      "Needs a schema registry",
      "Schema registry: missing",
      "TODO schema registry",
      "without Apicurio",
    ]) {
      const note = avro();
      note.nodes.push(node("todo", "generic.service", { label: "Platform", sublabel: words }));
      expect(ids(note, "schema-registry"), words).toEqual(["warning:schema-registry:topic"]);
    }
    // A topic is never the registry, even one named for it.
    const named = avro();
    named.nodes.push(node("sr-topic", "kafka.topic", { label: "_schemas", sublabel: "Schema Registry storage" }));
    expect(ids(named, "schema-registry")).toEqual(["warning:schema-registry:topic"]);
  });

  it("JSON, no format, a word that only contains avro, and brokers that aren't Kafka don't fire", () => {
    expect(ids(avro({ contentType: "application/json" }), "schema-registry")).toEqual([]);
    expect(ids(avro({}), "schema-registry")).toEqual([]);
    const word = avro({});
    word.nodes[2].label = "avronic.events";
    expect(ids(word, "schema-registry")).toEqual([]);
    for (const stencil of ["gcp.pubsub", "azure.event-hubs", "rabbitmq.queue", "gcp.cloud-storage"]) {
      const d = avro();
      d.nodes[2].stencil = stencil;
      expect(ids(d, "schema-registry"), stencil).toEqual([]);
    }
  });

  it("another broker on the way isn't a client; a topic nobody uses still gets the registry alone", () => {
    const d = avro();
    d.nodes.push(node("mirror", "kafka.topic", { label: "orders.mirror" }));
    d.edges.push(msg("topic", "mirror"));
    expect(of(d, "schema-registry")[0].elements).toEqual(["topic", "orders", "ship", "bill"]);
    const lone = diagram([node("t", "kafka.topic", { props: { contentType: "avro/binary" } })], []);
    const [finding] = of(lone, "schema-registry");
    expect(finding.message).toMatch(/^t carries Avro\. With no schema registry/);
    expect(finding.fix?.ops).toHaveLength(1);
    expect(applyOps(lone, finding.fix!.ops!).errors).toEqual([]);
  });

  it("stays within one edit batch: more clients than one step takes give no fix, and the row says so", () => {
    const d = avro();
    for (let i = 0; i < 100; i++) {
      d.nodes.push(node(`c${i}`, "service.go"));
      d.edges.push(msg("topic", `c${i}`));
    }
    const [finding] = of(d, "schema-registry");
    expect(finding.fix).toBeUndefined();
    expect(finding.message).toMatch(/too big a change for one step/);
  });
});

describe("the Checks card fixture (tests/e2e/checks-rules.spec.ts)", () => {
  it("raises the schema-registry warning and the secret-identity suggestion, nothing else", async () => {
    const { readFileSync } = await import("node:fs");
    const d = JSON.parse(readFileSync("tests/fixtures/checks/payments-ledger.diagram.json", "utf8")) as DiagramFile;
    expect(runChecks(d).findings.map((f) => `${f.severity} ${f.id}`)).toEqual([
      "warning schema-registry:payments",
      "suggestion secret-identity:kv",
    ]);
  });
});
