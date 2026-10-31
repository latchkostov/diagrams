import routeExample from "../examples/api-route-table.json";
import dmzExample from "../examples/contoso-dmz.json";
import type { DiagramFile } from "../model/types";
import { t } from "../i18n";

/** Small practice views of existing public stories; stable route and connection IDs survive trimming. */
export function addressPractice(): DiagramFile {
  const d = structuredClone(routeExample) as DiagramFile;
  d.title = t("tutorials.routeByAddress.title");
  delete d.description;
  d.nodes = d.nodes.filter((n) => ["app", "gateway", "tracking", "pricing"].includes(n.id));
  d.edges = d.edges.filter((e) => ["app-gateway", "to-tracking", "to-pricing"].includes(e.id));
  d.planning!.requestRoutes = d.planning!.requestRoutes!.filter((r) =>
    ["track-parcel", "get-quote", "old-tracking"].includes(r.id),
  );
  for (const n of d.nodes) {
    delete n.sublabel;
    n.y = n.id === "pricing" ? 180 : 0;
  }
  d.nodes[0].label = t("tutorials.routeByAddress.app");
  d.nodes[0].props = {
    ratePerSec: 8,
    trafficMix: {
      mode: "shares",
      entries: [
        { routeId: "track-parcel", share: 0.5 },
        { routeId: "get-quote", share: 0.5 },
      ],
    },
  };
  d.nodes[1].label = t("tutorials.routeByAddress.gateway");
  d.nodes[1].props = {
    latencyMs: 20,
    jitter: 0,
    routeTable: {
      rules: [
        {
          id: "parcels",
          match: { methods: ["GET"], path: { kind: "template", value: "/v1/orders/{id}" } },
          targets: [{ edgeId: "to-pricing", weight: 1 }],
        },
        {
          id: "quotes",
          match: { methods: ["POST"], path: { kind: "exact", value: "/v1/users" } },
          targets: [{ edgeId: "to-pricing", weight: 1 }],
        },
      ],
    },
  };
  d.nodes[2].label = t("tutorials.routeByAddress.ordersService");
  d.nodes[3].label = t("tutorials.routeByAddress.usersService");
  for (const r of d.planning!.requestRoutes!) {
    r.address.path = r.id === "track-parcel" ? "/v1/orders/8421" : r.id === "get-quote" ? "/v1/users" : "/v0/track";
    r.label =
      r.id === "track-parcel"
        ? t("tutorials.routeByAddress.orders")
        : r.id === "get-quote"
          ? t("tutorials.routeByAddress.users")
          : t("tutorials.routeByAddress.unknown");
  }
  for (const e of d.edges) delete e.label;
  d.simulations = [
    {
      id: "address-mix",
      title: t("tutorials.routeByAddress.mix"),
      seed: 41,
      scale: 1,
      durationMs: 15000,
      traffic: [{ id: "mix", node: "app", shape: { kind: "constant", ratePerSec: 8, durationMs: 10000 } }],
    },
    {
      id: "unknown-address",
      title: t("tutorials.routeByAddress.unknown"),
      seed: 41,
      scale: 1,
      durationMs: 10000,
      setup: { props: { app: { trafficMix: { mode: "shares", entries: [{ routeId: "old-tracking", share: 1 }] } } } },
      traffic: [{ id: "unknown", node: "app", shape: { kind: "burst", count: 10, atMs: 100 } }],
    },
  ];
  return d;
}

export function policyPractice(): DiagramFile {
  const d = structuredClone(dmzExample) as DiagramFile;
  d.title = t("tutorials.networkPolicy.title");
  delete d.description;
  delete d.groups;
  const ids = ["visitors", "probes", "firewall", "app", "admin"];
  d.nodes = d.nodes.filter((n) => ids.includes(n.id));
  d.nodes.forEach((n, i) => {
    delete n.group;
    delete n.sublabel;
    n.x = i < 2 ? 0 : i === 2 ? 280 : 560;
    n.y = i === 1 || i === 4 ? 180 : 0;
    n.label = [
      t("tutorials.networkPolicy.browser"),
      t("tutorials.networkPolicy.probe"),
      t("tutorials.networkPolicy.firewall"),
      t("tutorials.networkPolicy.api"),
      t("tutorials.networkPolicy.admin"),
    ][i];
  });
  const admin = d.nodes.find((n) => n.id === "admin")!;
  admin.stencil = "service.go";
  admin.props = { latencyMs: 40, jitter: 0, failureRate: 0 };
  d.edges = [
    { id: "web-in", from: "visitors", to: "firewall", kind: "sync" },
    { id: "probe-in", from: "probes", to: "firewall", kind: "sync" },
    { id: "allow-web", from: "firewall", to: "app", kind: "sync", props: { filter: ["WebRequest"] } },
    { id: "deny-admin", from: "firewall", to: "admin", kind: "sync", props: { filter: ["AdminProbe"], deny: true } },
  ];
  d.simulations = [
    {
      id: "policy-traffic",
      title: t("tutorials.networkPolicy.traffic"),
      seed: 41,
      scale: 1,
      durationMs: 10000,
      traffic: [
        {
          id: "web",
          node: "visitors",
          messageType: "WebRequest",
          shape: { kind: "constant", ratePerSec: 8, durationMs: 6000 },
        },
        {
          id: "admin",
          node: "probes",
          messageType: "AdminProbe",
          shape: { kind: "constant", ratePerSec: 2, durationMs: 6000 },
        },
      ],
    },
  ];
  return d;
}

export function checksPractice(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: t("tutorials.checksAndFixes.title"),
    nodes: [
      { id: "api", stencil: "client.browser", label: t("tutorials.networkPolicy.browser"), x: 0, y: 0 },
      { id: "api-service", stencil: "service.node", label: t("tutorials.checksAndFixes.api"), x: 240, y: 0 },
      { id: "topic", stencil: "kafka.topic", label: t("tutorials.checksAndFixes.topic"), x: 480, y: 0 },
    ],
    edges: [
      { id: "call-api", from: "api", to: "api-service", kind: "sync" },
      { id: "publish", from: "api-service", to: "topic", kind: "async" },
    ],
    simulations: [
      {
        id: "small-burst",
        title: t("tutorials.checksAndFixes.burst"),
        seed: 41,
        scale: 1,
        durationMs: 5000,
        traffic: [{ id: "burst", node: "api", shape: { kind: "burst", count: 10, atMs: 0 } }],
      },
    ],
  };
}
