import type { DiagramFile } from "../model/types";
import { addressText, routeLook, type RequestRoute, type RouteLook, type RouteTable } from "../model/requestRouting";
import { t } from "../i18n/core";

/**
 * Request routing in a trace's words: a route's address and look, and a router's rule by its place in the table
 * ("rule 1", "Default"). One reader for the trace card, slow motion and the sequence diagram.
 */
export interface RouteWords {
  /** "POST /orders", or undefined for a message without an address. */
  address(route: string | undefined): string | undefined;
  look(route: string | undefined): RouteLook | undefined;
  /** "rule 2" (or its name), "Default" for "". */
  rule(node: string | undefined, rule: string | undefined): string | undefined;
  /** "POST /orders · rule 1 · 10% split" for a router's choice; the address alone elsewhere. */
  hop(route: string | undefined, node?: string, rule?: string, weight?: number): string | undefined;
  /** "no route: rejected 404" and friends, for a router's refusal reasons. */
  refusal(reason: string | undefined): string | undefined;
}

export function routeWords(diagram: Pick<DiagramFile, "nodes"> & Partial<Pick<DiagramFile, "planning">>): RouteWords {
  const routes = new Map<string, RequestRoute>((diagram.planning?.requestRoutes ?? []).map((r) => [r.id, r]));
  const tables = new Map<string, RouteTable>();
  for (const n of diagram.nodes) {
    const table = n.props?.routeTable as RouteTable | undefined;
    if (table && Array.isArray(table.rules)) tables.set(n.id, table);
  }
  const words: RouteWords = {
    address: (id) => {
      const route = id === undefined ? undefined : routes.get(id);
      return route ? addressText(route.address) : id;
    },
    look: (id) => {
      const route = id === undefined ? undefined : routes.get(id);
      return route ? routeLook(route) : undefined;
    },
    rule: (node, rule) => {
      if (rule === undefined) return undefined;
      if (rule === "") return t("routing.default");
      const rules = node ? tables.get(node)?.rules : undefined;
      const index = rules?.findIndex((r) => r.id === rule) ?? -1;
      const named = index >= 0 ? rules![index].label : undefined;
      return named ?? (index >= 0 ? t("routing.ruleNumber", { n: index + 1 }) : rule);
    },
    hop: (route, node, rule, weight) => {
      const address = words.address(route);
      const ruleText = words.rule(node, rule);
      const parts = [address ?? t("routing.unaddressed")];
      if (ruleText) parts.push(ruleText);
      if (weight !== undefined && weight < 1) parts.push(t("routing.splitShare", { share: weight }));
      return route === undefined && ruleText === undefined ? undefined : parts.join(" → ");
    },
    refusal: (reason) =>
      reason === "route-not-found"
        ? t("routing.notFound")
        : reason === "route-no-eligible-target"
          ? t("routing.noTarget")
          : undefined,
  };
  return words;
}
