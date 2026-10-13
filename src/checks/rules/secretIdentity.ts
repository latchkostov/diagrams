import type { DiagramOp } from "../../ai";
import { relationOf } from "../../model/relations";
import { MAX_BATCH, fitsRef, listNames, sharedBoundary, type CheckContext } from "../context";
import { WORKLOAD_IDENTITY, cloudOf, isSecretStore, isWorkload } from "../kinds";
import type { CheckFix, CheckRule } from "../types";

// 9. secret-identity: services that read a secret store (a Secret dependency) and don't say what they sign in to it
// as (no Identity dependency). The credential a service uses to open the vault is itself a secret, unless it's the
// platform's workload identity: an Azure managed identity, an AWS IAM role, a Google Cloud service account. One
// aggregated Suggestion per diagram, since a diagram that draws secrets usually draws all of them the same way.
// Only where the identity has a name: the service's cloud (its stencil or its boundary), else the store's. A
// HashiCorp Vault or a generic store read by a service on no cloud signs in with Vault's own methods (Kubernetes,
// AppRole), which the diagram has no node for, so it doesn't fire. Nor when the words already say it ("managed
// identity" on the vault, say). The fix gives each service an identity of its own, with an Identity dependency
// (least privilege: each signs in only to what it reads); one shared identity is a chip. Both only add: a dependency
// carries no traffic, so the simulation plays as before.

type Cloud = keyof typeof WORKLOAD_IDENTITY;

/** Words that say how a service signs in. */
const SAID =
  /managed[\s-]?identit|workload[\s-]?identit|service[\s-]?account|\biam[\s-]?role|execution[\s-]?role|instance[\s-]?profile|\birsa\b|pod[\s-]?identit/i;
/** edit_diagram's label limit. */
const MAX_LABEL = 200;
const ORDER: readonly Cloud[] = ["azure", "aws", "gcp"];
/** One for each service, on the button: "Add managed identities" (the chip beside it says "One shared identity"). */
const PLURAL: Record<Cloud, string> = { azure: "managed identities", aws: "IAM roles", gcp: "service accounts" };

const text = (n: { label: string; sublabel?: string }) => `${n.label} ${n.sublabel ?? ""}`;
const toneCloud = (tone: string | undefined): Cloud | undefined =>
  tone === "azure" || tone === "aws" || tone === "gcp" ? tone : undefined;

/** "Email sender identity", shortened to fit an edit op's label. */
const identityLabel = (name: string) => `${name.slice(0, MAX_LABEL - 9).trimEnd()} identity`;

function addIdentities(ctx: CheckContext, groups: ReadonlyMap<Cloud, readonly string[]>, each: boolean): DiagramOp[] {
  const ops: DiagramOp[] = [];
  let n = 0;
  for (const [cloud, readers] of groups) {
    const identity = WORKLOAD_IDENTITY[cloud];
    const sets = each ? readers.map((r) => [r]) : [readers];
    for (const set of sets) {
      const key = ctx.freshKey(`new-identity-${++n}`);
      const label = set.length === 1 ? identityLabel(ctx.name(set[0])) : identity.label;
      const boundary = sharedBoundary(ctx, set);
      ops.push({
        op: "add_node",
        kind: identity.kind,
        label,
        sublabel: "workload identity",
        key,
        ...(boundary ? { in: boundary } : {}),
      });
      for (const reader of set) ops.push({ op: "connect", from: reader, to: key, relation: "identity" });
    }
  }
  return ops;
}

export const secretIdentity: CheckRule = {
  id: "secret-identity",
  name: "Services read secrets without an identity",
  about:
    "A service needs a credential to open a vault; stored with the service, it's one more secret. A workload identity (managed identity, IAM role, service account) needs none. " +
    "Fires once per diagram, for services on a cloud with a Secret dependency and no Identity dependency; config stores and Kubernetes Secrets don't count.",
  detect(ctx) {
    const tones = new Map((ctx.diagram.groups ?? []).map((g) => [g.id, g.tone]));
    const hasIdentity = new Set<string>();
    /** Each reader's secret dependencies, in file order. */
    const reads = new Map<string, { store: string; said: boolean }[]>();
    for (const e of ctx.diagram.edges) {
      const relation = relationOf(e);
      if (relation === "identity") hasIdentity.add(e.from);
      if (relation !== "secret") continue;
      const store = ctx.nodes.get(e.to);
      const reader = ctx.nodes.get(e.from);
      if (!store || !reader || !isSecretStore(store.stencil) || !isWorkload(reader.stencil)) continue;
      const said = SAID.test(`${text(store)} ${e.label ?? ""}`);
      const list = reads.get(reader.id);
      if (list) list.push({ store: store.id, said });
      else reads.set(reader.id, [{ store: store.id, said }]);
    }
    // The services that don't say what they sign in as, in file order, by the cloud whose identity they'd use.
    const missing: { id: string; cloud: Cloud }[] = [];
    for (const node of ctx.diagram.nodes) {
      const list = reads.get(node.id);
      if (!list || hasIdentity.has(node.id) || SAID.test(text(node)) || list.some((r) => r.said)) continue;
      const cloud =
        cloudOf(node.stencil) ??
        toneCloud(node.group ? tones.get(node.group) : undefined) ??
        list.map((r) => cloudOf(ctx.nodes.get(r.store)!.stencil)).find(Boolean);
      if (cloud) missing.push({ id: node.id, cloud });
    }
    if (!missing.length) return [];

    const readers = missing.map((m) => m.id);
    const used = missing.flatMap((m) => reads.get(m.id)!);
    const inFile = new Map(ctx.diagram.nodes.map((n, i) => [n.id, i]));
    const stores = [...new Set(used.map((r) => r.store))].sort((a, b) => inFile.get(a)! - inFile.get(b)!);
    const groups = new Map<Cloud, string[]>();
    for (const cloud of ORDER) {
      const list = missing.filter((m) => m.cloud === cloud).map((m) => m.id);
      if (list.length) groups.set(cloud, list);
    }
    const n = readers.length;
    const one = groups.size === 1 ? WORKLOAD_IDENTITY[[...groups.keys()][0]] : undefined;
    const noun = one?.noun ?? "a workload identity";
    const nouns = groups.size === 1 ? PLURAL[[...groups.keys()][0]] : "workload identities";
    const names = listNames(readers.map(ctx.name));

    // Each service its own identity (least privilege); a chip shares one per cloud. Each only while it fits the
    // operation schema (one edit batch, ids short enough to name), counted before any op is built: one each is two ops
    // per service, the shared one an identity per cloud plus a connection per service. When one each doesn't fit and
    // the shared one does, the button shares one and the row says why.
    const safe = readers.every(fitsRef);
    const sharedLabel = one ? `Add one shared ${noun.replace(/^an? /, "")}` : "Add one shared identity per cloud";
    const each = safe && 2 * n <= MAX_BATCH;
    const shared = safe && groups.size + n <= MAX_BATCH;
    const fix: CheckFix | undefined = each
      ? {
          label: `Add ${n === 1 ? noun : nouns}`,
          ops: addIdentities(ctx, groups, true),
          // Shared differs only where a cloud has more than one service.
          ...(shared && [...groups.values()].some((r) => r.length > 1)
            ? {
                options: [
                  {
                    label: sharedLabel,
                    short: one ? "One shared identity" : "One shared per cloud",
                    ops: addIdentities(ctx, groups, false),
                  },
                ],
              }
            : {}),
        }
      : shared
        ? { label: sharedLabel, ops: addIdentities(ctx, groups, false) }
        : undefined;
    const why = !fix
      ? " That's too big a change for one step (an edit batch): add the identity by hand."
      : !each
        ? " One for each service is too big a change for one step (an edit batch), so the fix adds one they share."
        : "";
    return [
      {
        id: `secret-identity:${stores[0]}`,
        rule: "secret-identity",
        severity: "suggestion",
        target: stores[0],
        // The vault and the services: their Secret dependencies would only repeat them as chips.
        elements: [stores[0], ...readers, ...stores.slice(1)],
        title:
          n === 1 ? `${names} reads secrets without an identity` : `${n} services read secrets without an identity`,
        message:
          `${names} read${n === 1 ? "s" : ""} secrets from ${listNames(stores.map(ctx.name))}, but the diagram doesn't say what ${n === 1 ? "it signs" : "they sign"} in as. ` +
          `With ${noun}, ${n === 1 ? "it gets" : "they get"} in with no stored credential to leak or rotate.${why}`,
        rationale:
          "A service needs a credential to open a vault, and one stored with the service is just one more secret. A workload identity (an Azure managed identity, an AWS IAM role, a Google Cloud service account) signs it in with nothing to store or rotate, and one per service gives each only the access it needs (least privilege).",
        ...(fix ? { fix } : {}),
      },
    ];
  },
};
