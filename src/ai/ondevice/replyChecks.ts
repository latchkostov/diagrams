// Checks of a small model's reply against the person's request, all deterministic and conservative:
// - the components a request names (light noun-phrase heuristic over resolveKind), and whether the
//   reply added them;
// - which stencil an added node should get when its kind word and its label disagree;
// - names copied from the few-shot examples.

import type { DiagramFile } from "../../model/types";
import type { DiagramOp } from "../index";
import { getStencil } from "../../stencils/registry";
import { namedStencil, resolveKind } from "../stencils";
import { EXAMPLE_NAMES } from "./examples";

const lower = (s: string) => s.toLowerCase();
const words = (s: string) =>
  lower(s)
    .split(/[^a-z0-9#+]+/)
    .filter((w) => w.length > 1);
const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const GENERIC = new Set(["service", "node", "new", "the", "a", "an", "app", "api", "server"]);

/**
 * Words that end a component's name in a request: articles, prepositions, verbs, pronouns, and the
 * nouns of what flows (events, objects, data) or where things sit (boundary, region).
 */
const BREAKS = new Set(
  (
    "a an the to into in on onto from of for and or with through via toward towards that which then its it this " +
    "these those their there is are be by as at after before between behind out up down over inside within new " +
    "add put make rename remove replace insert connect connects connected " +
    "calls call uses use writes write reads read consumes consume consuming feeds feed routes route sends send " +
    "publishes publish invokes invoke stores store saves save accesses access exports export starts start " +
    "delivers deliver persists persist forwards forward fans fan resolves resolve subscribes subscribe listens " +
    "listen pulls pull triggers trigger talks talk queries query posts post pushes push emits emit produces produce " +
    "consumed written read sent published invoked stored saved routed fed called used started delivered " +
    "boundary boundaries region zone"
  ).split(" "),
);
/** What flows (events, objects, data): a break only in lower case ("an event", not "Event Hubs"). */
const FLOWS = new Set(
  "events event objects object data messages message documents document files file secrets secret records record".split(
    " ",
  ),
);

export interface NamedComponent {
  /** The words as the request has them ("Go service"). */
  phrase: string;
  stencil: string;
}

/**
 * The components a request names, in order: runs of words between BREAKS that plausibly name a stencil
 * (namedStencil). Conservative by design: a phrase it can't place is left out, never guessed.
 */
export function requestComponents(request: string): NamedComponent[] {
  // Words keep their dots (".NET", "orders.created"); trailing punctuation goes.
  const tokens = request
    .split(/[\s,;:!?()"]+/)
    .map((t) => t.replace(/[.]+$/, ""))
    .filter(Boolean);
  const out: NamedComponent[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      const phrase = run.join(" ");
      const stencil = namedStencil(phrase);
      if (stencil) out.push({ phrase, stencil });
    }
    run = [];
  };
  for (const t of tokens) {
    if (BREAKS.has(lower(t)) || (FLOWS.has(t) && t === lower(t))) flush();
    else run.push(t);
  }
  flush();
  return out;
}

/** Do all of these words appear in the request (singular or plural)? */
export function inRequest(phrase: string, request: string): boolean {
  const have = new Set(words(request).map(stem));
  const mine = words(phrase).map(stem);
  return mine.length > 0 && mine.every((w) => have.has(w));
}

/**
 * The kind to resolve for an added node. When the model's kind word disagrees with a label that names a
 * stencil and comes from the request (kind "Lambda", label "Azure Function"), the label wins. The kind
 * stays when:
 * - the label is the model's own ("billing-worker") or generic ("Orders API", "Events", "Gateway": a
 *   one-word label must be the stencil's own name, like "Prometheus" or "Scheduler");
 * - the request names the kind too ("Redis cache" in "A Go service uses Redis cache");
 * - the label names a generic stencil in the same role as the kind's (label "Cache", kind "Memcached").
 */
export function kindFor(kind: string, label: string, request: string): string {
  if (!request || !inRequest(label, request)) return kind;
  const byLabel = namedStencil(label);
  if (!byLabel || byLabel === "generic.service") return kind;
  const labelWords = words(label).map(stem);
  if (labelWords.length === 1) {
    const s = getStencil(byLabel);
    const names = [s.label, ...s.id.split(".")].map((n) => words(n).map(stem).join(" "));
    if (!names.includes(labelWords[0])) return kind;
  }
  const byKind = resolveKind(kind, label).id;
  if (byKind === byLabel) return kind;
  if (inRequest(kind, request) && namedStencil(kind) === byKind) return kind;
  if (byLabel.startsWith("generic.") && getStencil(byLabel).simRole === getStencil(byKind).simRole) return kind;
  return label;
}

interface NewNode {
  key: string;
  label: string;
  kind: string;
  stencil: string;
}

const newNodes = (ops: readonly DiagramOp[]): NewNode[] =>
  ops.flatMap((o) =>
    (o.op === "add_node" || o.op === "insert_between") && o.key
      ? [{ key: o.key, label: o.label, kind: o.kind, stencil: resolveKind(o.kind, o.label).id }]
      : [],
  );

/** Could this new node be the component the request names? */
function covers(node: NewNode, c: NamedComponent): boolean {
  if (node.stencil === c.stencil || namedStencil(node.label) === c.stencil || namedStencil(node.kind) === c.stencil)
    return true;
  // A generic name ("a processor", "a service") is any node in the same role.
  if (c.stencil.startsWith("generic.") && getStencil(node.stencil).simRole === getStencil(c.stencil).simRole)
    return true;
  const mine = words(`${node.label} ${node.kind}`)
    .map(stem)
    .filter((w) => !GENERIC.has(w));
  return words(c.phrase)
    .map(stem)
    .some((w) => !GENERIC.has(w) && mine.includes(w));
}

/** A request that relates things ("calls", "writes to", "between"): its new nodes must be connected. */
const RELATES =
  /\b(?:calls?|uses?|writes?|reads?|consumes?|feeds?|routes?|sends?|publish(?:es)?|invokes?|stores?|saves?|accesses|access|exports?|starts?|delivers?|persists?|forwards?|fans? out|connects?|resolves?|subscribes?|listens?|pulls?|triggers?|talks?|quer(?:y|ies)|posts?|pushes?|emits?|produces?|between|after|before|behind|in front of)\b/i;

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);

/**
 * Is anything the request asks for missing from the reply? Into a new, empty diagram every named
 * component must be added (one node each); in any request that relates things, every new node must be
 * connected. The message tells the model what to add or connect. Null when complete.
 */
export function incompleteness(ops: readonly DiagramOp[], request: string, diagram: DiagramFile): string | null {
  const nodes = newNodes(ops);
  const linked = new Set<string>();
  for (const o of ops) {
    if (o.op === "connect") linked.add(o.from).add(o.to);
    if (o.op === "insert_between" && o.key) linked.add(o.key);
  }
  const loose = RELATES.test(request) ? nodes.filter((n) => !linked.has(n.key)) : [];
  let missing: NamedComponent[] = [];
  if (!diagram.nodes.length) {
    // One node per named component; the most constrained components pick first.
    const comps = requestComponents(request);
    const options = comps.map((c) => nodes.filter((n) => covers(n, c)));
    const order = comps.map((_, i) => i).sort((a, b) => options[a].length - options[b].length);
    const taken = new Set<string>();
    for (const i of order) {
      const pick = options[i].find((n) => !taken.has(n.key));
      if (pick) taken.add(pick.key);
      else missing.push(comps[i]);
    }
    missing = comps.filter((c) => missing.includes(c));
  }
  if (!missing.length && !loose.length) return null;
  const added = nodes.map((n) => n.label);
  if (missing.length)
    return `You added ${added.length ? list(added) : "nothing"} but not ${list(missing.map((m) => `the ${m.phrase}`))}${
      loose.length || !ops.some((o) => o.op === "connect") ? ", and nothing connects them" : ""
    }. Add every component the request names and connect them.`;
  return `You added ${list(loose.map((n) => n.label))} but nothing connects ${loose.length > 1 ? "them" : "it"}. Connect every component the request names.`;
}

/**
 * A name from the few-shot examples ("sample-worker") that the reply uses although neither the request
 * nor the diagram has it. Null when there's none.
 */
export function leakedName(names: readonly string[], request: string, diagram: DiagramFile): string | null {
  const known = lower([request, ...diagram.nodes.map((n) => `${n.id} ${n.label}`)].join(" "));
  for (const name of names)
    for (const example of EXAMPLE_NAMES) {
      const e = lower(example);
      if (lower(name).includes(e) && !known.includes(e)) return example;
    }
  return null;
}
