import type { DiagramOp } from "../../ai";
import type { CompiledEdge } from "../../sim/topology";
import { listNames } from "../context";
import { isService, isSharedByDesign } from "../kinds";
import type { CheckRule, Finding } from "../types";

// 5. shared-database: a service reaching into a database another boundary owns. Database per service: a store
// stays private to the service that owns it, reachable only through its API. A boundary often means a network or
// a cloud, not a team, so a store fires only when its boundary also holds a service that uses it (the owner):
// a "Data" tier with no service of its own never does. Warehouses, lakes and object storage are shared by
// design, and connectors and loaders (Kafka Connect, Airbyte, dbt) move data between stores on purpose, so
// neither counts. A Warning with one owner, and its fix asks the owner instead; a Suggestion when several
// services in the boundary already share the store (the boundary is more likely a network than a team).

export const sharedDatabase: CheckRule = {
  id: "shared-database",
  name: "A service uses another's database",
  about:
    "Each service's data should be private to it and reached through its API: a second service using the same tables couples their deploys and schemas. " +
    "Fires for a flow from a service into a database in a boundary that holds the service using it; warehouses, object storage and connectors don't count.",
  detect(ctx) {
    const groups = new Set((ctx.diagram.groups ?? []).map((g) => g.id));
    const groupName = new Map((ctx.diagram.groups ?? []).map((g) => [g.id, g.label.trim() || g.id]));
    const service = (id: string) => isService(ctx.nodes.get(id)!.stencil, ctx.role(id));
    // Flows between services and stores, by store: both directions, dead-letter routes aside.
    const touching = new Map<string, CompiledEdge[]>();
    for (const e of ctx.topology.edges) {
      if (e.dlq) continue;
      const store = ctx.role(e.to) === "store" ? e.to : ctx.role(e.from) === "store" ? e.from : undefined;
      const other = store === e.to ? e.from : e.to;
      if (!store || !service(other)) continue;
      const list = touching.get(store);
      if (list) list.push(e);
      else touching.set(store, [e]);
    }
    const findings: Finding[] = [];
    for (const node of ctx.diagram.nodes) {
      const id = node.id;
      const boundary = node.group;
      const edges = touching.get(id);
      if (!edges || !boundary || !groups.has(boundary) || isSharedByDesign(node.stencil)) continue;
      const other = (e: CompiledEdge) => (e.to === id ? e.from : e.to);
      const inside = (e: CompiledEdge) => ctx.nodes.get(other(e))!.group === boundary;
      const owners = [...new Set(edges.filter(inside).map(other))];
      if (!owners.length) continue;
      // Each outside service writing or querying the store, with its flows into it.
      const foreign = new Map<string, CompiledEdge[]>();
      for (const e of edges) {
        if (e.to !== id || inside(e)) continue;
        const list = foreign.get(e.from);
        if (list) list.push(e);
        else foreign.set(e.from, [e]);
      }
      const store = ctx.name(id);
      const where = groupName.get(boundary)!;
      for (const [from, into] of foreign) {
        const user = ctx.name(from);
        const elements = [into[0].id, from, id, ...owners, ...into.slice(1).map((e) => e.id)];
        const rationale =
          "Database per service: each service's data stays private to it and is reached only through its API. A second service using the same tables couples their deploys and schemas, so neither can change them alone.";
        if (owners.length === 1) {
          const owner = owners[0];
          const ownerName = ctx.name(owner);
          // A request to the owner for each flow, keeping its label and settings (a filter, timing): one plain flow
          // needs none when the two already talk. A flow whose id another element shares can't be removed by id
          // (edit ops would remove that element instead), so then there's no fix.
          const talks = ctx.requests(from).some((e) => e.to === owner);
          const ops: DiagramOp[] = [];
          into.forEach((e, i) => {
            const edge = ctx.edges.get(e.id)!;
            const props = edge.props && Object.keys(edge.props).length ? edge.props : undefined;
            if (talks && !props) return;
            const key = ctx.freshKey(`ask-${owner}-${i + 1}`);
            ops.push({
              op: "connect",
              from,
              to: owner,
              kind: "sync",
              key,
              ...(edge.label?.trim() ? { label: edge.label } : {}),
            });
            if (props) ops.push({ op: "update", target: key, props: structuredClone(props) });
          });
          ops.push({ op: "remove", targets: into.map((e) => e.id) });
          findings.push({
            id: `shared-database:${into[0].id}`,
            rule: "shared-database",
            severity: "warning",
            target: into[0].id,
            elements,
            title: `${user} uses ${ownerName}'s database`,
            message: `${store} sits in ${where} with ${ownerName}, which uses it. ${user}, outside ${where}, goes to it directly: a change to its tables now has to ship in both.`,
            rationale,
            fix: { label: `Ask ${ownerName} instead`, ops },
          });
        } else {
          findings.push({
            id: `shared-database:${into[0].id}`,
            rule: "shared-database",
            severity: "suggestion",
            target: into[0].id,
            elements,
            title: `${user} uses a database in ${where}`,
            message: `${store} is used by ${listNames(owners.map(ctx.name))} in ${where}, and ${user}, outside it, goes to it directly. If ${where} is one team, ask its services instead; if it's a network, ignore this here.`,
            rationale,
          });
        }
      }
    }
    return findings;
  },
};
