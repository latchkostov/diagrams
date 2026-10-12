import type { DiagramOp } from "../../ai";
import type { DiagramGroup } from "../../model/types";
import { catalog } from "../../stencils/catalog";
import type { CompiledEdge } from "../../sim/topology";
import { listNames, type CheckContext } from "../context";
import { cloudOf, isFrontDoor, isOutsideClient, isSelfHostedService } from "../kinds";
import type { CheckFix, CheckFixOption, CheckRule, Finding } from "../types";

// 6. entry-gateway: an outside client (a browser, an app, a partner's webhook) calling a service you run, with
// nothing in front of it, while the diagram's other traffic comes in through a gateway: it goes around the way
// in, so nothing filters attacks or limits the rate. Only when the diagram draws a way in (a gateway or load
// balancer that clients reach): diagrams that leave ingress out do so on purpose, to stay at a higher level.
// Managed platforms with their own front door (Cloud Run, Container Apps, Functions, Lambda) don't fire. A
// Suggestion. The fix goes through an existing gateway, or adds one of the service's cloud (chips), and only when
// that keeps every flow as it was (see `lossless` and `usable`); otherwise there's no fix and the row says why.

/** New gateways to offer, by the service's cloud. */
const NEW_GATEWAYS: Record<"azure" | "aws" | "gcp" | "other", readonly string[]> = {
  azure: ["azure.api-management", "azure.front-door"],
  aws: ["aws.api-gateway"],
  gcp: ["gcp.cloud-load-balancing"],
  other: ["generic.firewall", "kong"],
};
/** Existing gateways offered at most. */
const MAX_EXISTING = 2;
const stencilLabel = (id: string) => catalog.find((s) => s.id === id)?.label ?? id;
const kindOf = (e: CompiledEdge): "sync" | "async" => (e.sync ? "sync" : "async");

/** The front doors (gateways that are a way in) each outside client reaches through gateways alone. */
function frontDoors(ctx: CheckContext, clients: readonly string[]): Map<string, Set<string>> {
  const reach = new Map<string, Set<string>>();
  for (const client of clients) {
    const doors = new Set<string>();
    const seen = new Set<string>();
    for (const queue = [client]; queue.length;) {
      for (const e of ctx.routes(queue.pop()!)) {
        if (seen.has(e.to) || ctx.role(e.to) !== "gateway") continue;
        seen.add(e.to);
        if (isFrontDoor(ctx.nodes.get(e.to)!.stencil, "gateway")) doors.add(e.to);
        queue.push(e.to);
      }
    }
    reach.set(client, doors);
  }
  return reach;
}

/** The diagram's cloud for a service: its own, its boundary's, else the one most of the diagram uses. */
function cloudFor(
  ctx: CheckContext,
  service: string,
  majority: keyof typeof NEW_GATEWAYS,
  tones: ReadonlyMap<string, DiagramGroup["tone"]>,
) {
  const node = ctx.nodes.get(service)!;
  const tone = node.group ? tones.get(node.group) : undefined;
  return cloudOf(node.stencil) ?? (tone === "azure" || tone === "aws" || tone === "gcp" ? tone : majority);
}

function majorityCloud(ctx: CheckContext): keyof typeof NEW_GATEWAYS {
  const count = { azure: 0, aws: 0, gcp: 0 };
  for (const n of ctx.diagram.nodes) {
    const cloud = cloudOf(n.stencil);
    if (cloud) count[cloud]++;
  }
  const best = (["azure", "aws", "gcp"] as const).reduce((a, b) => (count[b] > count[a] ? b : a));
  return count[best] ? best : "other";
}

export const entryGateway: CheckRule = {
  id: "entry-gateway",
  name: "A client goes around the gateway",
  about:
    "Traffic from outside should come in through a gateway or firewall that filters attacks and limits the rate. " +
    "Fires for an outside client calling a service you run directly, when the diagram's other traffic comes in through a gateway; managed platforms with their own front door don't count.",
  detect(ctx) {
    const clients = ctx.diagram.nodes.filter((n) => isOutsideClient(n.stencil, ctx.role(n.id))).map((n) => n.id);
    if (!clients.length) return [];
    const reach = frontDoors(ctx, clients);
    const doors = [...new Set([...reach.values()].flatMap((d) => [...d]))];
    if (!doors.length) return [];
    // Direct calls, by the service they reach.
    const direct = new Map<string, CompiledEdge[]>();
    for (const client of clients)
      for (const e of ctx.routes(client)) {
        if (ctx.role(e.to) !== "processor" || !isSelfHostedService(ctx.nodes.get(e.to)!.stencil)) continue;
        const list = direct.get(e.to);
        if (list) list.push(e);
        else direct.set(e.to, [e]);
      }
    const majority = majorityCloud(ctx);
    const tones = new Map((ctx.diagram.groups ?? []).map((g) => [g.id, g.tone]));
    // Ways in, preferred first: one that leads to a service, then reading order. Ranked once for every finding.
    const leads = (door: string) => Number(ctx.routes(door).some((e) => ctx.role(e.to) === "processor"));
    const byPreference = [...doors].sort((a, b) => leads(b) - leads(a) || ctx.rank(a) - ctx.rank(b));
    const order = new Map(byPreference.map((d, i) => [d, i]));
    const doorKinds = new Set(doors.map((d) => ctx.nodes.get(d)!.stencil));
    // Connections between each pair of nodes, any relationship (insert_between needs exactly one), counted once.
    let counted: Map<string, number> | undefined;
    const pairs = () => {
      if (counted) return counted;
      counted = new Map();
      for (const e of ctx.diagram.edges) {
        const key = `${e.from}\u0000${e.to}`;
        counted.set(key, (counted.get(key) ?? 0) + 1);
      }
      return counted;
    };
    /** A flow with no settings: nothing on it (a filter, a message type, timing, a share) for a reroute to keep. */
    const plain = (id: string) => {
      const props = ctx.edges.get(id)?.props;
      return !props || Object.keys(props).length === 0;
    };
    const label = (id: string) => ctx.edges.get(id)?.label?.trim() || undefined;
    const findings: Finding[] = [];
    for (const [service, edges] of direct) {
      const callers = [...new Set(edges.map((e) => e.from))];
      const kind = kindOf(edges[0]);
      // The way in these callers' neighbours use: one they reach already, then the diagram's own order.
      const theirs = [...new Set(callers.flatMap((c) => [...reach.get(c)!]))].sort(
        (a, b) => order.get(a)! - order.get(b)!,
      );
      const preferred = [...new Set([...theirs, ...byPreference])];
      // A one-click fix only when it keeps every flow as it is. Each direct connection becomes a connection to the
      // gateway, one for one (a client sends a copy down each of its connections), and the gateway sends all of it
      // on to the service. So the connections must be plain and of one kind (requests or messages).
      const keeps = edges.every((e) => plain(e.id) && kindOf(e) === kind);
      // An existing gateway keeps its own traffic only when its one route out is a plain one to this service, of
      // the same kind: a gateway shares its traffic round-robin among its routes, so a new route would take some.
      const usable = (door: string) => {
        const out = ctx.routes(door);
        return out.length === 1 && out[0].to === service && kindOf(out[0]) === kind && plain(out[0].id);
      };
      const connect = (e: CompiledEdge, to: string): DiagramOp => ({
        op: "connect",
        from: e.from,
        to,
        kind,
        ...(label(e.id) ? { label: label(e.id) } : {}),
      });
      const through = (door: string): DiagramOp[] => [
        ...edges.map((e) => connect(e, door)),
        { op: "remove", targets: edges.map((e) => e.id) },
      ];
      const put = (stencil: string): DiagramOp[] => {
        const key = ctx.freshKey("new-gateway");
        const name = stencilLabel(stencil);
        const [first, ...rest] = edges;
        // One connection between the first caller and the service: the gateway goes in its middle, as dropping a
        // node on it does (a plain connection's split keeps only its label, on the first half).
        const head: DiagramOp[] =
          pairs().get(`${first.from}\u0000${service}`) === 1
            ? [{ op: "insert_between", from: first.from, to: service, kind: stencil, label: name, key }]
            : [
                { op: "add_node", kind: stencil, label: name, key },
                connect(first, key),
                { op: "connect", from: key, to: service, kind },
                { op: "remove", targets: [first.id] },
              ];
        return [
          ...head,
          ...rest.map((e) => connect(e, key)),
          ...(rest.length ? [{ op: "remove" as const, targets: rest.map((e) => e.id) }] : []),
        ];
      };
      const options: CheckFixOption[] = keeps
        ? [
            ...preferred
              .filter(usable)
              .slice(0, MAX_EXISTING)
              .map((door) => ({ label: `Go through ${ctx.name(door)}`, short: ctx.name(door), ops: through(door) })),
            ...NEW_GATEWAYS[cloudFor(ctx, service, majority, tones)]
              .filter((stencil) => !doorKinds.has(stencil))
              .map((stencil) => ({
                label: `Put ${stencilLabel(stencil)} in front`,
                short: stencilLabel(stencil),
                kind: stencil,
                ops: put(stencil),
              })),
          ]
        : [];
      const [primary, ...more] = options;
      const fix: CheckFix | undefined = primary && {
        label: primary.label,
        ops: primary.ops,
        ...(more.length ? { options: more } : {}),
      };
      const name = ctx.name(service);
      const who = listNames(callers.map(ctx.name));
      const door = ctx.name(preferred[0]);
      findings.push({
        id: `entry-gateway:${service}`,
        rule: "entry-gateway",
        severity: "suggestion",
        target: service,
        elements: [service, ...callers, ...edges.map((e) => e.id)],
        title: `${who} call${callers.length === 1 ? "s" : ""} ${name} directly`,
        message:
          `Traffic from outside comes in through ${door}, but ${who} reach${callers.length === 1 ? "es" : ""} ${name} around it: nothing in front of ${name} filters attacks or limits the rate.` +
          (fix
            ? ""
            : !keeps
              ? " Its direct connections carry settings (a filter, a message type, timing) or mix requests and messages, which a gateway in between would change: put one in front by hand."
              : " Each gateway here also routes elsewhere, so this traffic would be shared out among its routes: put one in front by hand."),
        rationale:
          "Traffic from the internet should pass a gateway or web application firewall before it reaches a service: it terminates TLS, filters attacks, checks who's calling and limits the rate, in one place.",
        ...(fix ? { fix } : {}),
      });
    }
    return findings;
  },
};
