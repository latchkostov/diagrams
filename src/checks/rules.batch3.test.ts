import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramFile, DiagramGroup, DiagramNode, Simulation } from "../model/types";
import { createSimulationRun } from "../sim/simulation";
import { stencilRole } from "../stencils/roles";
import { applyOps } from "../ai";
import { runChecks } from "./run";
import { dominators, stronglyConnected } from "./graph";
import { SYNC_CHAIN_MIN } from "./rules/syncChain";
import { MAX_COUNT } from "../sim/capacityPlanning";
import { nodeSimPropsSchema } from "../model/simProps";

// The four batch 3 rules (sync-chain, shared-database, entry-gateway, single-point) on tiny diagrams: what
// fires, what doesn't, the edge cases (loops, self-loops, disconnected parts), and that each fix clears its
// finding. docs/research/architecture-checks.md, "Batch 3".

let x = 0;
const node = (
  id: string,
  stencil: string,
  props?: Record<string, unknown>,
  label = id,
  group?: string,
): DiagramNode => ({
  id,
  stencil,
  label,
  x: (x += 300),
  y: 0,
  ...(props ? { props } : {}),
  ...(group ? { group } : {}),
});
const msg = (from: string, to: string, label?: string): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "async",
  ...(label ? { label } : {}),
});
const req = (from: string, to: string, label?: string): DiagramEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "sync",
  ...(label ? { label } : {}),
});
const box = (id: string, label = id, tone?: DiagramGroup["tone"]): DiagramGroup => ({
  id,
  label,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...(tone ? { tone } : {}),
});
const diagram = (nodes: DiagramNode[], edges: DiagramEdge[], extra: Partial<DiagramFile> = {}): DiagramFile => ({
  format: "diagrams/v1",
  title: "t",
  nodes,
  edges,
  ...extra,
});
const of = (d: DiagramFile, rule: string) => runChecks(d, { rules: [rule as never] }).findings;
const ids = (d: DiagramFile, rule: string) => of(d, rule).map((f) => `${f.severity}:${f.id}`);
/** Applies a finding's fix (or one of its options) and returns the diagram after it. */
function fixed(d: DiagramFile, rule: string, option?: string): DiagramFile {
  const [finding] = of(d, rule);
  expect(finding, rule).toBeDefined();
  const ops = option ? finding.fix!.options!.find((o) => o.label === option)!.ops : finding.fix!.ops!;
  const result = applyOps(d, ops);
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
  return result.diagram;
}

/** Messages each node handles in a seeded run, every outside client sending a burst of 12. */
function delivered(d: DiagramFile): Record<string, number> {
  const sim: Simulation = {
    id: "t",
    title: "Delivery",
    seed: 7,
    traffic: d.nodes
      .filter((n) => n.stencil.startsWith("client.") || n.stencil === "generic.webhook")
      .map((n) => ({ id: `t-${n.id}`, node: n.id, shape: { kind: "burst" as const, count: 12 } })),
  };
  const run = createSimulationRun(d, sim);
  run.setSpeed(8);
  for (let i = 0; i < 4000 && !run.state().done; i++) run.step(25);
  const nodes = run.engine.snapshot().nodes;
  // Gateways aside: a reused one handles more by design (that's the fix); where its traffic lands is what counts.
  return Object.fromEntries(
    d.nodes.filter((n) => stencilRole(n.stencil) !== "gateway").map((n) => [n.id, nodes[n.id].processed]),
  );
}

/**
 * Every way the entry-gateway finding offers to fix it delivers what the diagram delivered: each node the diagram
 * had handles as many messages afterwards (gateways aside: a fix adds or reuses one on purpose).
 */
function preservesDelivery(d: DiagramFile) {
  const [finding] = of(d, "entry-gateway");
  const before = delivered(d);
  expect(Object.values(before).some((n) => n > 0)).toBe(true);
  for (const option of [{ label: finding.fix!.label, ops: finding.fix!.ops! }, ...(finding.fix!.options ?? [])]) {
    const result = applyOps(d, option.ops);
    expect(result.errors, option.label).toEqual([]);
    const after = delivered(result.diagram);
    expect(Object.fromEntries(Object.keys(before).map((id) => [id, after[id]])), option.label).toEqual(before);
  }
}

describe("graph", () => {
  it("dominators: a diamond's join is dominated by its fork, a loop by where it's entered", () => {
    const g: Record<string, string[]> = { r: ["a"], a: ["b", "c"], b: ["d"], c: ["d"], d: ["e"], e: ["d"] };
    const { idom, order } = dominators("r", (id) => g[id] ?? []);
    expect(order[0]).toBe("r");
    expect(Object.fromEntries(idom)).toEqual({ a: "r", b: "a", c: "a", d: "a", e: "d" });
  });

  it("dominators only see what the root reaches, and keep self-loops harmless", () => {
    const g: Record<string, string[]> = { r: ["a"], a: ["a", "b"], z: ["a"] };
    const { idom, order } = dominators("r", (id) => g[id] ?? []);
    expect(order.sort()).toEqual(["a", "b", "r"]);
    expect(Object.fromEntries(idom)).toEqual({ a: "r", b: "a" });
  });

  it("dominators and components run without recursion on a 20,000-node chain", () => {
    const n = 20_000;
    const next = (id: string) => {
      const i = Number(id.slice(1));
      return i + 1 < n ? [`n${i + 1}`] : [];
    };
    const { idom } = dominators("n0", next);
    expect(idom.get(`n${n - 1}`)).toBe(`n${n - 2}`);
    expect(stronglyConnected(["n0"], next)).toHaveLength(n);
  });
});

describe("sync-chain", () => {
  /** A client, a gateway, then `n` services in a row of requests, the last writing to a store. */
  const chain = (n: number) => {
    const services = Array.from({ length: n }, (_, i) => node(`s${i}`, "service.go", undefined, `Service ${i}`));
    return diagram(
      [node("web", "client.browser"), node("gw", "nginx"), ...services, node("db", "postgres")],
      [
        req("web", "gw"),
        req("gw", "s0"),
        ...services.slice(1).map((s, i) => req(`s${i}`, s.id)),
        req(`s${n - 1}`, "db"),
      ],
    );
  };

  it(`fires at ${SYNC_CHAIN_MIN} requests between services (five in a row), not at three`, () => {
    expect(ids(chain(4), "sync-chain")).toEqual([]);
    const [finding] = of(chain(5), "sync-chain");
    expect(finding).toMatchObject({
      id: "sync-chain:s0",
      severity: "warning",
      target: "s0",
      title: "4 requests deep",
      elements: ["s0", "s1", "s2", "s3", "s4", "s0-s1", "s1-s2", "s2-s3", "s3-s4"],
    });
    expect(finding.message).toBe(
      "Service 0 → Service 1 → Service 2 → Service 3 → Service 4: each waits for the next, so all 5 must be up, and their latencies add up. Making the last call a message means Service 0 no longer waits for Service 4.",
    );
    expect(finding.fix).toEqual({
      label: "Make Service 3 → Service 4 a message",
      ops: [{ op: "update", target: "s3-s4", kind: "async" }],
    });
    expect(ids(fixed(chain(5), "sync-chain"), "sync-chain")).toEqual([]);
  });

  it("calls from clients and gateways, and into stores, aren't hops; a message breaks the chain", () => {
    // web → gw → s0 … s3 → db is 3 service hops plus 3 that don't count.
    expect(ids(chain(4), "sync-chain")).toEqual([]);
    const d = chain(6);
    d.edges = d.edges.map((e) => (e.id === "s2-s3" ? { ...e, kind: "async" } : e));
    expect(ids(d, "sync-chain")).toEqual([]);
  });

  it("dependencies don't count as requests", () => {
    const d = chain(5);
    d.edges = d.edges.map((e) => (e.id === "s1-s2" ? { ...e, relation: "depends" } : e));
    expect(ids(d, "sync-chain")).toEqual([]);
  });

  it("a loop counts as one stop (sync-cycle reports it), and a self-loop as none", () => {
    const loop = diagram(
      ["a", "b", "c", "d", "e", "f"].map((id) => node(id, "service.java")),
      [req("a", "b"), req("b", "c"), req("c", "b"), req("c", "d"), req("d", "e"), req("e", "f"), req("f", "f")],
    );
    expect(ids(loop, "sync-chain")).toEqual(["warning:sync-chain:a"]);
    expect(of(loop, "sync-chain")[0].message).toMatch(/^a → b → c → d → e → f: /);
    expect(ids(loop, "sync-cycle")).toEqual(["warning:sync-cycle:b", "warning:sync-cycle:f"]);
    // Without the hop into the loop, it's three: b/c → d → e → f.
    loop.edges = loop.edges.filter((e) => e.id !== "a-b");
    expect(ids(loop, "sync-chain")).toEqual([]);
  });

  it("one finding per start; two starts that share a last hop give one, the longest", () => {
    const d = diagram(
      ["a1", "a0", "b", "c", "d", "e", "x", "y", "z", "w", "v"].map((id) => node(id, "generic.service")),
      [
        req("a1", "a0"),
        req("a0", "b"),
        req("b", "c"),
        req("c", "d"),
        req("d", "e"),
        // A second start, five deep into the same last hop, and a separate chain.
        req("x", "b"),
        req("y", "z"),
        req("z", "w"),
        req("w", "v"),
      ],
    );
    expect(ids(d, "sync-chain")).toEqual(["warning:sync-chain:a1"]);
    expect(of(d, "sync-chain")[0].title).toBe("5 requests deep");
    // Disconnected chains each get their own.
    d.nodes.push(node("u", "generic.service"));
    d.edges.push(req("u", "y"), req("v", "a1"));
    expect(ids(d, "sync-chain")).toEqual(["warning:sync-chain:u"]);
  });
});

describe("shared-database", () => {
  /** Orders owns orders-db inside its boundary; Billing, outside, writes to it too. */
  const shared = (extra: Partial<{ nodes: DiagramNode[]; edges: DiagramEdge[] }> = {}) =>
    diagram(
      [
        node("orders", "service.dotnet", undefined, "Order service", "team"),
        node("db", "postgres", undefined, "orders-db", "team"),
        node("billing", "service.java", undefined, "Billing"),
        ...(extra.nodes ?? []),
      ],
      [req("orders", "db"), req("billing", "db", "Read order totals"), ...(extra.edges ?? [])],
      { groups: [box("team", "Orders team")] },
    );

  it("warns when a service outside the boundary uses a database its owner uses inside", () => {
    const [finding] = of(shared(), "shared-database");
    expect(finding).toMatchObject({
      id: "shared-database:billing-db",
      severity: "warning",
      target: "billing-db",
      elements: ["billing-db", "billing", "db", "orders"],
      title: "Billing uses Order service's database",
    });
    expect(finding.message).toBe(
      "orders-db sits in Orders team with Order service, which uses it. Billing, outside Orders team, goes to it directly: a change to its tables now has to ship in both.",
    );
    expect(finding.fix).toEqual({
      label: "Ask Order service instead",
      ops: [
        { op: "connect", from: "billing", to: "orders", kind: "sync", key: "ask-orders-1", label: "Read order totals" },
        { op: "remove", targets: ["billing-db"] },
      ],
    });
    const after = fixed(shared(), "shared-database");
    expect(after.edges.find((e) => e.from === "billing")).toMatchObject({
      to: "orders",
      kind: "sync",
      label: "Read order totals",
    });
    expect(ids(after, "shared-database")).toEqual([]);
  });

  it("the request to the owner keeps each flow's settings, even when the two already talk", () => {
    const d = shared({ edges: [req("billing", "orders")] });
    d.edges = d.edges.map((e) => (e.id === "billing-db" ? { ...e, props: { filter: ["Totals*"], travelMs: 80 } } : e));
    const after = fixed(d, "shared-database");
    const asks = after.edges.filter((e) => e.from === "billing" && e.to === "orders");
    expect(asks.map((e) => e.props ?? null)).toEqual([null, { filter: ["Totals*"], travelMs: 80 }]);
    expect(after.nodes.map((n) => n.id).sort()).toEqual(d.nodes.map((n) => n.id).sort());
  });

  it("never removes a node that shares its id with the flow: no fix then", () => {
    // A file may use one id for a node and a connection; edit ops resolve it to the node, and removing that would
    // delete an unrelated service and its connections.
    const d = shared({
      nodes: [node("billing-db", "service.go", undefined, "Ledger")],
      edges: [req("ledger-in", "billing-db")],
    });
    d.nodes.push(node("ledger-in", "client.team"));
    const [finding] = of(d, "shared-database");
    expect(finding.id).toBe("shared-database:billing-db");
    expect(finding.fix).toBeUndefined();
  });

  it("the fix only removes the flow when the service already asks the owner", () => {
    const d = shared({ edges: [req("billing", "orders")] });
    expect(of(d, "shared-database")[0].fix?.ops).toEqual([{ op: "remove", targets: ["billing-db"] }]);
  });

  it("is quiet for a store with no service of its own in the boundary (a data tier), or in no boundary", () => {
    const tier = shared();
    tier.nodes = tier.nodes.map((n) => (n.id === "orders" ? { ...n, group: undefined } : n));
    expect(ids(tier, "shared-database")).toEqual([]);
    const none = shared();
    none.nodes = none.nodes.map((n) => ({ ...n, group: undefined }));
    expect(ids(none, "shared-database")).toEqual([]);
  });

  it("warehouses and object storage are shared by design; connectors and loaders aren't services", () => {
    const warehouse = shared();
    warehouse.nodes = warehouse.nodes.map((n) => (n.id === "db" ? { ...n, stencil: "snowflake" } : n));
    expect(ids(warehouse, "shared-database")).toEqual([]);
    const connector = shared();
    connector.nodes = connector.nodes.map((n) => (n.id === "billing" ? { ...n, stencil: "kafka.connect" } : n));
    expect(ids(connector, "shared-database")).toEqual([]);
  });

  it("reading the store's changes (a flow out of it) and dependencies don't count", () => {
    const cdc = shared();
    cdc.edges = [req("orders", "db"), msg("db", "billing", "WAL")];
    expect(ids(cdc, "shared-database")).toEqual([]);
    const dep = shared();
    dep.edges = [req("orders", "db"), { ...req("billing", "db"), relation: "depends" }];
    expect(ids(dep, "shared-database")).toEqual([]);
  });

  it("a suggestion without a fix when several services in the boundary share the store", () => {
    const d = shared({
      nodes: [node("refunds", "service.go", undefined, "Refunds", "team")],
      edges: [req("refunds", "db")],
    });
    const [finding] = of(d, "shared-database");
    expect(finding).toMatchObject({ severity: "suggestion", title: "Billing uses a database in Orders team" });
    expect(finding.message).toContain("used by Order service and Refunds in Orders team");
    expect(finding.fix).toBeUndefined();
  });

  it("a service in another boundary counts as outside; one finding per outside service", () => {
    const d = shared({
      nodes: [node("ship", "service.node", undefined, "Shipping", "logistics")],
      edges: [req("ship", "db"), msg("ship", "db")],
    });
    d.groups!.push(box("logistics"));
    d.edges = d.edges.map((e, i) => (e.from === "ship" ? { ...e, id: `ship-db-${i}` } : e));
    // Shipping was drawn first, so it reads first.
    expect(ids(d, "shared-database")).toEqual([
      "warning:shared-database:ship-db-2",
      "warning:shared-database:billing-db",
    ]);
    const ship = of(d, "shared-database")[0];
    expect(ship.elements).toEqual(["ship-db-2", "ship", "db", "orders", "ship-db-3"]);
    expect(ship.fix?.ops?.at(-1)).toEqual({ op: "remove", targets: ["ship-db-2", "ship-db-3"] });
  });
});

describe("entry-gateway", () => {
  /** A storefront through NGINX to the order service, and a mobile app straight to it. */
  const bypass = () =>
    diagram(
      [
        node("web", "client.browser", undefined, "Storefront"),
        node("mobile", "client.mobile", undefined, "Mobile app"),
        node("gw", "nginx", undefined, "Commerce gateway"),
        node("orders", "service.dotnet", undefined, "Order service"),
      ],
      [req("web", "gw"), req("gw", "orders", "POST /orders"), req("mobile", "orders", "POST /orders")],
    );

  it("suggests going through the gateway the diagram already has", () => {
    const [finding] = of(bypass(), "entry-gateway");
    expect(finding).toMatchObject({
      id: "entry-gateway:orders",
      severity: "suggestion",
      title: "Mobile app calls Order service directly",
      elements: ["orders", "mobile", "mobile-orders"],
    });
    expect(finding.message).toBe(
      "Traffic from outside comes in through Commerce gateway, but Mobile app reaches Order service around it: nothing in front of Order service filters attacks or limits the rate.",
    );
    expect(finding.fix?.label).toBe("Go through Commerce gateway");
    // One connection to the gateway for each direct one, with its label; the gateway's own route stays as it is.
    expect(finding.fix?.ops).toEqual([
      { op: "connect", from: "mobile", to: "gw", kind: "sync", label: "POST /orders" },
      { op: "remove", targets: ["mobile-orders"] },
    ]);
    // The other ways: a new gateway, by the diagram's cloud (none here: a firewall or Kong).
    expect(finding.fix?.options?.map((o) => [o.short, o.kind])).toEqual([
      ["Firewall / WAF", "generic.firewall"],
      ["Kong Gateway", "kong"],
    ]);
    const after = fixed(bypass(), "entry-gateway");
    expect(after.edges.filter((e) => e.to === "orders").map((e) => e.from)).toEqual(["gw"]);
    expect(ids(after, "entry-gateway")).toEqual([]);
    preservesDelivery(bypass());
  });

  it("is quiet when the diagram draws no way in at all: ingress is left out on purpose", () => {
    const d = bypass();
    d.nodes = d.nodes.filter((n) => n.id !== "gw");
    d.edges = d.edges.filter((e) => e.from !== "gw" && e.to !== "gw");
    expect(ids(d, "entry-gateway")).toEqual([]);
    // DNS alone isn't a way in either.
    d.nodes.push(node("dns", "aws.route53"));
    d.edges.push(req("web", "dns"));
    expect(ids(d, "entry-gateway")).toEqual([]);
  });

  it("managed platforms with their own front door, and an on-call engineer, don't fire", () => {
    for (const stencil of ["aws.lambda", "gcp.cloud-run", "azure.container-apps", "azure.functions"]) {
      const d = bypass();
      d.nodes = d.nodes.map((n) => (n.id === "orders" ? { ...n, stencil } : n));
      expect(ids(d, "entry-gateway"), stencil).toEqual([]);
    }
    const team = bypass();
    team.nodes = team.nodes.map((n) => (n.id === "mobile" ? { ...n, stencil: "client.team" } : n));
    expect(ids(team, "entry-gateway")).toEqual([]);
  });

  it("offers the service's cloud's gateways; one inserts on the connection, and every plain caller shares it", () => {
    const d = bypass();
    d.nodes.push(node("partner", "generic.webhook", undefined, "Partner hooks"));
    d.edges.push(req("partner", "orders", "order.updated"));
    d.nodes = d.nodes.map((n) => (n.id === "orders" ? { ...n, group: "az" } : n));
    d.groups = [box("az", "Azure", "azure")];
    const [finding] = of(d, "entry-gateway");
    expect(finding.title).toBe("Mobile app and Partner hooks call Order service directly");
    expect(finding.fix?.options?.map((o) => o.label)).toEqual([
      "Put API Management in front",
      "Put Front Door in front",
    ]);
    expect(finding.fix?.options?.[0].ops).toEqual([
      {
        op: "insert_between",
        from: "mobile",
        to: "orders",
        kind: "azure.api-management",
        label: "API Management",
        key: "new-gateway",
      },
      { op: "connect", from: "partner", to: "new-gateway", kind: "sync", label: "order.updated" },
      { op: "remove", targets: ["partner-orders"] },
    ]);
    const after = fixed(d, "entry-gateway", "Put API Management in front");
    const apim = after.nodes.find((n) => n.stencil === "azure.api-management")!;
    expect(
      after.edges
        .filter((e) => e.to === apim.id)
        .map((e) => e.from)
        .sort(),
    ).toEqual(["mobile", "partner"]);
    expect(
      after.edges
        .filter((e) => e.to === "orders")
        .map((e) => e.from)
        .sort(),
    ).toEqual([apim.id, "gw"]);
    expect(ids(after, "entry-gateway")).toEqual([]);
    preservesDelivery(d);
  });

  it("two connections from one caller: two to the gateway, so the service still gets both copies", () => {
    const d = bypass();
    d.edges.push({ ...req("mobile", "orders"), id: "mobile-orders-2" });
    const [finding] = of(d, "entry-gateway");
    expect(finding.fix?.ops?.filter((o) => o.op === "connect")).toHaveLength(2);
    const option = finding.fix!.options![0];
    expect(option.ops[0]).toMatchObject({ op: "add_node", kind: "generic.firewall" });
    expect(ids(fixed(d, "entry-gateway", option.label), "entry-gateway")).toEqual([]);
    preservesDelivery(d);
  });

  it("an existing gateway that also routes elsewhere isn't offered: it would share this traffic out", () => {
    // Storefront → gateway → Catalog, and the app straight to Orders: a gateway → Orders route would take half of
    // the storefront's requests away from Catalog (a gateway sends round-robin).
    const d = diagram(
      [
        node("web", "client.browser", { messageType: "Browse" }, "Storefront"),
        node("app", "client.mobile", { messageType: "Order" }, "Mobile app"),
        node("gw", "nginx", undefined, "Gateway"),
        node("catalog", "service.go", undefined, "Catalog"),
        node("orders", "service.dotnet", undefined, "Orders"),
      ],
      [req("web", "gw"), req("gw", "catalog"), req("app", "orders")],
    );
    const [finding] = of(d, "entry-gateway");
    expect([finding.fix!.label, ...finding.fix!.options!.map((o) => o.label)]).toEqual([
      "Put Firewall / WAF in front",
      "Put Kong Gateway in front",
    ]);
    preservesDelivery(d);
    // Two routes out, one of them to Orders: still shared out.
    d.edges.push(req("gw", "orders"));
    expect(of(d, "entry-gateway")[0].fix?.label).toBe("Put Firewall / WAF in front");
    preservesDelivery(d);
  });

  it("an existing gateway whose route filters the traffic isn't offered", () => {
    const d = bypass();
    d.nodes = d.nodes.map((n) =>
      n.id === "web"
        ? { ...n, props: { messageType: "WebOrder" } }
        : n.id === "mobile"
          ? { ...n, props: { messageType: "AppOrder" } }
          : n,
    );
    d.edges = d.edges.map((e) => (e.id === "gw-orders" ? { ...e, props: { filter: ["Web*"] } } : e));
    const [finding] = of(d, "entry-gateway");
    expect(finding.fix?.label).toBe("Put Firewall / WAF in front");
    preservesDelivery(d);
  });

  it("no fix when the direct connections carry settings or mix requests and messages; the row says why", () => {
    for (const props of [{ filter: ["Created"] }, { emits: "Renamed" }, { travelMs: 900 }, { share: 0.5 }]) {
      const d = bypass();
      d.edges = d.edges.map((e) => (e.id === "mobile-orders" ? { ...e, props } : e));
      const [finding] = of(d, "entry-gateway");
      expect(finding.fix, JSON.stringify(props)).toBeUndefined();
      expect(finding.message).toContain("carry settings (a filter, a message type, timing)");
    }
    const mixed = bypass();
    mixed.edges.push({ ...msg("mobile", "orders"), id: "mobile-orders-async" });
    expect(of(mixed, "entry-gateway")[0].fix).toBeUndefined();
  });

  it("no fix when a direct connection's id is also a node's: removing it would remove that node", () => {
    const d = bypass();
    d.nodes.push(node("mobile-orders", "service.go", undefined, "Unrelated"));
    const [finding] = of(d, "entry-gateway");
    expect(finding.fix).toBeUndefined();
    expect(finding.message).toContain("share their ids with other elements");
  });

  it("behind DNS: the load balancer routes only to its own service, so a new gateway is offered", () => {
    const d = diagram(
      [
        node("users", "client.user", undefined, "Customers"),
        node("r53", "aws.route53"),
        node("alb", "aws.elb", undefined, "Load balancer"),
        node("api", "aws.ecs", undefined, "Checkout API"),
        node("admin", "service.go", undefined, "Admin API"),
      ],
      [req("users", "r53"), req("r53", "alb"), req("alb", "api"), req("users", "admin")],
    );
    const [finding] = of(d, "entry-gateway");
    expect(finding.message).toContain("comes in through Load balancer");
    expect(finding.fix?.label).toBe("Put Amazon API Gateway in front");
    preservesDelivery(d);
  });
});

describe("single-point", () => {
  /** Shop → NGINX → Order service → orders-db, with the service's and gateway's props. */
  const path = (service?: Record<string, unknown>, gateway?: Record<string, unknown>, rate = 2) =>
    diagram(
      [
        node("shop", "client.browser", { ratePerSec: rate }, "Storefront"),
        node("gw", "nginx", gateway, "Commerce gateway"),
        node("orders", "service.dotnet", service, "Order service"),
        node("db", "postgres"),
      ],
      [req("shop", "gw"), req("gw", "orders"), req("orders", "db")],
    );

  it("is quiet when the diagram doesn't say how many replicas run (the default isn't a claim)", () => {
    expect(ids(path(), "single-point")).toEqual([]);
  });

  it("suggests a second replica when the diagram says one, for services and gateways on the only path", () => {
    expect(ids(path({ replicas: 1 }, { replicas: 1 }), "single-point")).toEqual([
      "suggestion:single-point:gw",
      "suggestion:single-point:orders",
    ]);
    const finding = of(path({ replicas: 1 }), "single-point")[0];
    expect(finding).toMatchObject({
      title: "Every request goes through one Order service",
      elements: ["orders", "shop"],
      message:
        "It runs 1 replica, and every request from Storefront goes through it: if it stops, Storefront gets nothing.",
      fix: { label: "Set replicas to 2", ops: [{ op: "update", target: "orders", props: { replicas: 2 } }] },
    });
    expect(ids(fixed(path({ replicas: 1 }), "single-point"), "single-point")).toEqual([]);
    expect(ids(path({ replicas: 3 }), "single-point")).toEqual([]);
  });

  it("warns when capacity also puts it at 80% or more, replicas said or not, and sizes the fix", () => {
    // 16 a second at once with 4 × 250 ms: 14 a second is 88%.
    const busy = path(undefined, undefined, 14);
    const [finding] = of(busy, "single-point");
    expect(finding).toMatchObject({ id: "single-point:orders", severity: "warning" });
    expect(finding.message).toMatch(/^It runs 1 replica at 88% of what it can handle/);
    expect(finding.fix?.ops).toEqual([{ op: "update", target: "orders", props: { replicas: 2 } }]);
    const overloaded = of(path(undefined, undefined, 40), "single-point")[0];
    expect(overloaded.fix?.label).toBe("Set replicas to 5");
    expect(ids(fixed(busy, "single-point"), "single-point")).toEqual([]);
  });

  it("only the way through: two services behind a load balancer aren't; where they join again is", () => {
    const d = diagram(
      [
        node("shop", "client.browser"),
        node("lb", "load-balancer"),
        node("a", "service.go", { replicas: 1 }),
        node("b", "service.go", { replicas: 1 }),
        node("core", "service.java", { replicas: 1 }),
        node("db", "postgres"),
      ],
      [req("shop", "lb"), req("lb", "a"), req("lb", "b"), req("a", "core"), req("b", "core"), req("core", "db")],
    );
    expect(ids(d, "single-point")).toEqual(["suggestion:single-point:core"]);
  });

  it("managed gateways, serverless compute and async consumers don't fire", () => {
    const managed = path({ replicas: 1 });
    managed.nodes = managed.nodes.map((n) =>
      n.id === "gw"
        ? { ...n, stencil: "aws.api-gateway", props: { replicas: 1 } }
        : n.id === "orders"
          ? { ...n, stencil: "aws.lambda" }
          : n,
    );
    expect(ids(managed, "single-point")).toEqual([]);
    const consumer = diagram(
      [node("shop", "client.browser"), node("q", "aws.sqs"), node("w", "service.go", { replicas: 1 })],
      [msg("shop", "q"), msg("q", "w")],
    );
    expect(ids(consumer, "single-point")).toEqual([]);
  });

  it("names every entry it stops, and handles loops of requests with no end", () => {
    const d = path({ replicas: 1 });
    d.nodes.push(node("app", "client.mobile", undefined, "Mobile app"));
    d.edges.push(req("app", "orders"));
    const [finding] = of(d, "single-point");
    expect(finding.elements).toEqual(["orders", "shop", "app"]);
    expect(finding.message).toContain("every request from Storefront and Mobile app goes through it");
    const loop = diagram(
      [
        node("shop", "client.browser"),
        node("a", "service.go", { replicas: 1 }),
        node("b", "service.go", { replicas: 1 }),
      ],
      [req("shop", "a"), req("a", "b"), req("b", "a")],
    );
    expect(ids(loop, "single-point")).toEqual(["suggestion:single-point:a"]);
  });
});

describe("fixes never change what they don't own", () => {
  it("a replica fix stays within the op schema's bound, and says when replicas alone aren't enough", () => {
    // 10,000 a second into one replica that handles 1 a second: capacity planning would want 18,182.
    const d = diagram(
      [
        node("shop", "client.browser", { ratePerSec: 10_000 }, "Storefront"),
        node("api", "service.go", { replicas: 1, concurrency: 1, latencyMs: 1000 }, "API"),
      ],
      [req("shop", "api")],
    );
    const [finding] = of(d, "single-point");
    expect(finding.severity).toBe("warning");
    const to = (finding.fix!.ops![0] as unknown as { props: { replicas: number } }).props.replicas;
    expect(to).toBeGreaterThanOrEqual(2);
    expect(to).toBeLessThanOrEqual(MAX_COUNT);
    expect(applyOps(d, finding.fix!.ops!).errors).toEqual([]);
    expect(finding.message).toContain("More replicas alone can't bring it under its limit");
    // The bound is the node props schema's.
    const schema = nodeSimPropsSchema.properties as Record<string, { maximum?: number }>;
    expect(schema.replicas.maximum).toBe(MAX_COUNT);
  });

  it("no update by a connection id another element shares: it would change that element", () => {
    const chain = diagram(
      ["a", "b", "c", "d", "e"].map((id) => node(id, "service.go")),
      [req("a", "b"), req("b", "c"), req("c", "d"), req("d", "e")],
    );
    expect(of(chain, "sync-chain")[0].fix?.ops).toBeDefined();
    chain.nodes.push(node("d-e", "postgres"));
    expect(of(chain, "sync-chain")[0].fix).toBeUndefined();

    const loop = diagram([node("a", "service.go"), node("b", "service.go")], [req("a", "b"), req("b", "a")]);
    expect(of(loop, "sync-cycle")[0].fix?.ops).toBeDefined();
    loop.nodes.push(node("b-a", "postgres"));
    expect(of(loop, "sync-cycle")[0].fix).toBeUndefined();

    const dlq = diagram(
      [
        node("api", "service.node"),
        node("q", "aws.sqs"),
        node("w", "service.go", { failureRate: 1 }),
        node("parked", "aws.sqs", undefined, "q-dlq"),
      ],
      [msg("api", "q"), msg("q", "w"), { ...msg("q", "parked"), props: { dlq: true, filter: [] } }],
    );
    expect(of(dlq, "dead-letter")[0].fix?.ops).toBeDefined();
    dlq.nodes.push(node("q-parked", "service.java"));
    const [finding] = of(dlq, "dead-letter");
    expect(finding.severity).toBe("warning");
    expect(finding.fix).toBeUndefined();
  });
});
