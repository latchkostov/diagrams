// Checks of a small model's reply against the person's request, all deterministic and conservative:
// - the components a request names (light noun-phrase heuristic over resolveKind), and whether the
//   reply added them;
// - which stencil an added node should get when its kind word and its label disagree;
// - names copied from the few-shot examples.

import type { DiagramFile } from "../../model/types";
import type { DiagramOp } from "../index";
import { getStencil } from "../../stencils/registry";
import { confidentStencil, isRoleWord, namedStencil, resolveKind } from "../stencils";
import { EXAMPLE_NAMES } from "./examples";
import { NEGATION, relationFlow, requestRelations } from "./requestRelations";

const lower = (s: string) => s.toLowerCase();

export { CONSUMES } from "./requestRelations";
const words = (s: string) =>
  lower(s)
    .split(/[^a-z0-9#+]+/)
    .filter((w) => w.length > 1);
const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const GENERIC = new Set(["service", "node", "new", "the", "a", "an", "app", "api", "server"]);

/**
 * Words that end a component's name in a request: articles, prepositions, verbs, pronouns, and where
 * things sit (boundary, region).
 */
const BREAKS = new Set(
  (
    "a an the to into in on onto from of for and or but with through via toward towards that which then its it this " +
    "these those their there is are be by as at after before between behind out up down over inside within new " +
    "add put make rename remove replace insert connect connects connected not yet do don't " +
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
/** Before a mention, these make it a reference back to a component already named ("the service"). */
const DEFINITE = new Set(["the", "that", "this", "its", "their", "same"]);

export interface NamedComponent {
  /** The words as the request has them ("Go service"). */
  phrase: string;
  stencil: string;
}

interface Mention extends NamedComponent {
  /** Preceded by "the", "that"…: may refer back to a component named earlier. */
  definite: boolean;
}

const norm = (phrase: string) =>
  words(phrase)
    .map(stem)
    .filter((w) => !DEFINITE.has(w))
    .join(" ");

/** The request's mentions of components, in order (each run of words between BREAKS that names one). */
function mentions(request: string): Mention[] {
  // Words keep their dots (".NET", "orders.created"); trailing punctuation goes.
  const tokens = request
    .split(/[\s,;:!?()"]+/)
    .map((t) => t.replace(/[.]+$/, ""))
    .filter(Boolean);
  const runs: { words: string[]; definite: boolean; then: string }[] = [];
  let run: string[] = [];
  let prev = "";
  let definite = false;
  for (const t of tokens) {
    const l = lower(t);
    if (BREAKS.has(l) || (FLOWS.has(t) && t === l)) {
      if (run.length) runs.push({ words: run, definite, then: l });
      run = [];
      prev = l;
    } else {
      // A run's first word: is it right after "the", "that"…?
      if (!run.length) definite = DEFINITE.has(prev);
      run.push(t);
    }
  }
  if (run.length) runs.push({ words: run, definite, then: "" });
  const out: Mention[] = [];
  for (const [i, r] of runs.entries()) {
    let phrase = r.words.join(" ");
    // "billing and shipping consumers": the head noun of the next run is shared ("billing consumers").
    const next = runs[i + 1];
    if (r.then === "and" && next && !namedStencil(phrase)) {
      const head = next.words[next.words.length - 1];
      if (next.words.length > 1 && isRoleWord(stem(lower(head)))) phrase = `${phrase} ${head}`;
    }
    const stencil = namedStencil(phrase);
    if (stencil) out.push({ phrase, stencil, definite: r.definite });
  }
  return out;
}

/**
 * The distinct components a request names, in order. A repeat of the same words ("Redis cache … Redis
 * cache") or a definite reference back ("a Go service … the service") is the same component; different
 * words are different components, even of one technology ("billing and shipping consumers": two).
 * Conservative by design: a phrase it can't place is left out, never guessed.
 */
export function requestComponents(request: string): NamedComponent[] {
  const out: NamedComponent[] = [];
  for (const m of mentions(request)) {
    const n = norm(m.phrase);
    const same = out.find((c) => {
      if (norm(c.phrase) === n) return true;
      if (!m.definite) return false;
      const earlier = norm(c.phrase).split(" ");
      return (
        n.split(" ").every((w) => earlier.includes(w)) ||
        (m.stencil === "generic.service" && getStencil(c.stencil).simRole === "processor")
      );
    });
    if (!same) out.push({ phrase: m.phrase, stencil: m.stencil });
  }
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
 * - the label strings two of the request's components together ("email_service" for "A service delivers
 *   email"): it names neither one;
 * - the request names the kind too ("Redis cache" in "A Go service uses Redis cache"), unless the kind
 *   is generic and the label names a specific stencil confidently (kind "service", label "App Service":
 *   the request's "service" is part of "App Service");
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
  const whole = requestComponents(request).filter((c) => {
    const cw = words(c.phrase).map(stem);
    return cw.length > 0 && cw.every((w) => labelWords.includes(w));
  });
  if (new Set(whole.map((c) => c.stencil)).size > 1) return kind;
  const byKind = resolveKind(kind, label).id;
  if (byKind === byLabel) return kind;
  if (byKind.startsWith("generic.") && confidentStencil(label) === byLabel) return label;
  if (inRequest(kind, request) && namedStencil(kind) === byKind) return kind;
  if (byLabel.startsWith("generic.") && getStencil(byLabel).simRole === getStencil(byKind).simRole) return kind;
  return label;
}

/** A node a reply adds, after kindFor: what every later decision reads. */
export interface NewNode {
  key: string;
  label: string;
  /** The effective kind (the label, when the label won). */
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

/** The words that tell two components apart: the phrase's words minus generic and technology words. */
const identityWords = (phrase: string, stencil: string) => {
  const tech = new Set([getStencil(stencil).label, stencil.replace(/[.-]/g, " ")].flatMap(words).map(stem));
  return words(phrase)
    .map(stem)
    .filter((w) => !GENERIC.has(w) && !tech.has(w));
};

/**
 * Which new node is each named component. Exact stencils first; where the request names two components
 * of one technology ("a billing Go service … a shipping Go service"), their label words tell them apart.
 * Then any node that covers a component, the most constrained first. `ambiguous` when a pairing came
 * down to order: completion then declines.
 */
export function matchComponents(
  comps: readonly NamedComponent[],
  nodes: readonly NewNode[],
): { assigned: (NewNode | undefined)[]; ambiguous: boolean } {
  const assigned: (NewNode | undefined)[] = comps.map(() => undefined);
  const taken = new Set<string>();
  let ambiguous = false;
  const overlap = (c: NamedComponent, n: NewNode) => {
    const mine = words(n.label).map(stem);
    return identityWords(c.phrase, c.stencil).filter((w) => mine.includes(w)).length;
  };
  for (const stencil of new Set(comps.map((c) => c.stencil))) {
    const cs = comps.map((c, i) => ({ c, i })).filter((x) => x.c.stencil === stencil);
    const ns = nodes.filter((n) => n.stencil === stencil);
    if (!ns.length) continue;
    if (cs.length === 1 && ns.length === 1) {
      assigned[cs[0].i] = ns[0];
      taken.add(ns[0].key);
      continue;
    }
    // Several of one technology: by label words, each pairing unique; otherwise by order, flagged.
    for (const { c, i } of cs) {
      const free = ns.filter((n) => !taken.has(n.key));
      const scored = free.map((n) => ({ n, s: overlap(c, n) }));
      const top = Math.max(0, ...scored.map((x) => x.s));
      const best = scored.filter((x) => x.s === top);
      const pick = top > 0 && best.length === 1 ? best[0].n : free[0];
      if (!pick) continue;
      if (!(top > 0 && best.length === 1)) ambiguous = true;
      assigned[i] = pick;
      taken.add(pick.key);
    }
  }
  const options = comps.map((c) => nodes.filter((n) => covers(n, c)));
  const order = comps.map((_, i) => i).sort((a, b) => options[a].length - options[b].length);
  for (const i of order) {
    if (assigned[i]) continue;
    const pick = options[i].find((n) => !taken.has(n.key));
    if (pick) {
      assigned[i] = pick;
      taken.add(pick.key);
    }
  }
  return { assigned, ambiguous };
}

/** A clause that relates things ("calls", "writes to", "between"): its new nodes must be connected. */
const RELATES =
  /\b(?:calls?|uses?|writes?|reads?|consumes?|feeds?|routes?|sends?|publish(?:es)?|invokes?|stores?|saves?|accesses|access|exports?|starts?|delivers?|persists?|forwards?|fans? out|connects?|resolves?|subscribes?|listens?|pulls?|triggers?|talks?|quer(?:y|ies)|posts?|pushes?|emits?|produces?|consumed|written|invoked|called|triggered|fed|routed|sent|published|stored|saved|used|between|after|before|behind|in front of)\b/i;
/** "…, but don't connect it yet", "unconnected": the person wants it left alone. */
const LEAVE =
  /\b(?:not|n't|never|without)\s+(?:connect(?:ed|ing)?|link(?:ed|ing)?|wir(?:e|ed|ing))\b|\b(?:un|dis)connected\b|\bstand-?alone\b|\bon its own\b/i;
/** A request's clauses: split at punctuation, conjunctions and "but". */
const clausesOf = (request: string) =>
  request
    .split(/[,;]|\.(?=\s|$)|\b(?:and|but|then|while)\b/i)
    .map((c) => c.trim())
    .filter(Boolean);

/** Does a clause talk about this node (its label, its kind's words, or a component it covers)? */
function mentionsNode(clause: string, node: NewNode): boolean {
  const have = new Set(
    words(clause)
      .map(stem)
      .filter((w) => !GENERIC.has(w)),
  );
  const mine = words(`${node.label} ${node.kind}`)
    .map(stem)
    .filter((w) => !GENERIC.has(w));
  return mine.some((w) => have.has(w)) || requestComponents(clause).some((c) => covers(node, c));
}

/**
 * Must this new node be connected? When a clause that talks about it relates things; never when the
 * request asks to leave it unconnected. A node no clause talks about is held to the whole request.
 */
function mustConnect(node: NewNode, request: string): boolean {
  const clauses = clausesOf(request).filter((c) => mentionsNode(c, node));
  if (clauses.some((c) => LEAVE.test(c)) || (!clauses.length && LEAVE.test(request))) return false;
  return clauses.length ? clauses.some((c) => RELATES.test(c)) : RELATES.test(request);
}

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);

/**
 * Is anything the request asks for missing from the reply? Into a new, empty diagram every named
 * component must be added (one node each); every new node a relating clause talks about must be
 * connected. The message tells the model what to add or connect. Null when complete.
 */
export function incompleteness(ops: readonly DiagramOp[], request: string, diagram: DiagramFile): string | null {
  const nodes = newNodes(ops);
  const linked = new Set<string>();
  for (const o of ops) {
    if (o.op === "connect") linked.add(o.from).add(o.to);
    if (o.op === "insert_between" && o.key) linked.add(o.key);
  }
  const loose = nodes.filter((n) => !linked.has(n.key) && mustConnect(n, request));
  let missing: NamedComponent[] = [];
  if (!diagram.nodes.length) {
    // One node per named component.
    const comps = requestComponents(request);
    const { assigned } = matchComponents(comps, nodes);
    missing = comps.filter((_, i) => !assigned[i]);
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

/** "a generic database", "an unspecified component": the request asks for the generic stencil itself. */
const QUALIFIED = /\b(?:generic|unspecified|any|some|plain)\b/i;

/**
 * Request–technology reconciliation: when the request names a stencil no new node has (".NET service")
 * and a new node has a stencil the request never mentions ("Go service", label "dotnet-service"), that
 * node becomes what the request named.
 * - Technologies meant for existing nodes are left out: a kind change the reply makes
 *   (`updateStencils`) and "make X a Y" in the request.
 * - A node whose label names one component ("billing" for "a billing Go service") is that component,
 *   and takes its technology.
 * - The rest pair by label words, then by role, then (one and one only) by order. A node that already is
 *   a component its label names (a Lambda labelled "email_service" is the request's "service") is never
 *   given another one.
 * It never takes a component that's an existing node. Returns each node's kind, changed or not.
 */
export function reconcileKinds(
  nodes: readonly { label: string; kind: string }[],
  request: string,
  diagram: DiagramFile,
  updateStencils: ReadonlySet<string> = new Set(),
): string[] {
  const kinds = nodes.map((n) => n.kind);
  if (!request || !nodes.length) return kinds;
  const existing = diagram.nodes.map((n) => norm(n.label));
  // "make Orders database a MongoDB": MongoDB is for an existing node.
  const madeInto = [...request.matchAll(/\bmake\s+.+?\s+(?:a|an|into)\s+(.+?)(?=$|[,;]|\.(?:\s|$)|\s+and\b)/gi)]
    .map((m) => namedStencil(m[1]))
    .filter((x): x is string => !!x);
  const comps = requestComponents(request).filter((c) => {
    if (updateStencils.has(c.stencil) || madeInto.includes(c.stencil)) return false;
    const n = norm(c.phrase);
    return !existing.some(
      (e) =>
        e === n ||
        (n &&
          e
            .split(" ")
            .filter(Boolean)
            .every((w) => n.split(" ").includes(w))),
    );
  });
  const stencilOf = (i: number) => resolveKind(kinds[i], nodes[i].label).id;
  const role = (id: string) => getStencil(id).simRole;
  const roleOk = (c: NamedComponent, i: number) =>
    c.stencil.startsWith("generic.") && !QUALIFIED.test(c.phrase) && role(stencilOf(i)) === role(c.stencil);
  const free = new Set(nodes.map((_, i) => i));
  const done = new Set<NamedComponent>();
  const assign = (c: NamedComponent, i: number) => {
    // The stencil id itself: the phrase could resolve elsewhere ("Workers" to Cloudflare Workers).
    if (stencilOf(i) !== c.stencil && !roleOk(c, i)) kinds[i] = c.stencil;
    free.delete(i);
    done.add(c);
  };
  // Identity by label: each node's label words name exactly one component, and it's that node's alone.
  const labelHits = (c: NamedComponent, i: number) => {
    const mine = words(nodes[i].label).map(stem);
    return identityWords(c.phrase, c.stencil).filter((w) => mine.includes(w)).length;
  };
  for (const c of comps) {
    const hits = [...free].filter((i) => labelHits(c, i) > 0);
    if (hits.length !== 1) continue;
    const i = hits[0];
    if (comps.filter((o) => o !== c && labelHits(o, i) > 0).length) continue;
    assign(c, i);
  }
  const had = (c: NamedComponent) => nodes.some((_, i) => stencilOf(i) === c.stencil || roleOk(c, i));
  const unmatched = comps.filter((c) => !done.has(c) && !had(c));
  // A node that already is a component its label names stays that component, even when its label also
  // has another component's word: a Lambda labelled "email_service" for "A service delivers email" is
  // the service, not the email.
  const fits = (c: NamedComponent, i: number) => {
    const mine = words(nodes[i].label).map(stem);
    const cw = words(c.phrase).map(stem);
    return cw.length > 0 && cw.every((w) => mine.includes(w)) && (stencilOf(i) === c.stencil || roleOk(c, i));
  };
  const eligible = [...free].filter(
    (i) =>
      !stencilOf(i).startsWith("generic.") &&
      !comps.some((c) => c.stencil === stencilOf(i)) &&
      !comps.some((c) => fits(c, i)),
  );
  const pool = new Set(eligible);
  if (!unmatched.length || !pool.size) return kinds;
  const take = (c: NamedComponent, i: number) => {
    kinds[i] = c.stencil;
    pool.delete(i);
  };
  const overlap = (c: NamedComponent, i: number) => {
    const mine = words(nodes[i].label)
      .map(stem)
      .filter((w) => !GENERIC.has(w));
    return words(c.phrase)
      .map(stem)
      .filter((w) => !GENERIC.has(w) && mine.includes(w)).length;
  };
  const left: NamedComponent[] = [];
  for (const c of unmatched) {
    const scored = [...pool].map((i) => ({ i, n: overlap(c, i) })).filter((x) => x.n > 0);
    const top = Math.max(0, ...scored.map((x) => x.n));
    const best = scored.filter((x) => x.n === top);
    if (best.length === 1) take(c, best[0].i);
    else left.push(c);
  }
  const rest: NamedComponent[] = [];
  for (const c of left) {
    const same = [...pool].filter((i) => role(stencilOf(i)) === role(c.stencil));
    if (same.length === 1) take(c, same[0]);
    else rest.push(c);
  }
  if (rest.length === 1 && pool.size === 1) take(rest[0], [...pool][0]);
  return kinds;
}

/**
 * Deterministic completion, after a retry still left a simple request incomplete. Only when it can't
 * guess wrong:
 * - into an empty diagram, a request naming two or three components and nothing negated ("don't
 *   connect", "without", "not yet", "leave…");
 * - every connection from an explicit relation in the request, its subject and object each naming exactly
 *   one component (a shared subject is a star: "A writes to B and reads from C" connects A to both);
 * - every component in some relation, and each one's node unambiguous.
 * The missing components are added from the request's words; each connection goes the way the shared
 * relation semantics say (requestRelations.ts), as a message or a request. Null when unsure.
 */
export function completeFromRequest(
  ops: readonly DiagramOp[],
  request: string,
  diagram: DiagramFile,
): DiagramOp[] | null {
  if (diagram.nodes.length || NEGATION.test(request) || LEAVE.test(request)) return null;
  const comps = requestComponents(request);
  if (comps.length < 2 || comps.length > 3) return null;
  const relations = requestRelations(request);
  if (!relations.length || relations.some((r) => r.negated)) return null;
  const which = (phrase: string) => {
    const p = lower(phrase);
    const hits = comps.map((c, i) => ({ c, i })).filter(({ c }) => p.includes(lower(c.phrase)));
    return hits.length === 1 ? hits[0].i : -1;
  };
  const pairs = relations.map((r) => ({ r, s: which(r.subject), o: which(r.object) }));
  if (pairs.some((p) => p.s < 0 || p.o < 0 || p.s === p.o)) return null;
  if (comps.some((_, i) => !pairs.some((p) => p.s === i || p.o === i))) return null;
  const out = [...ops];
  const { assigned, ambiguous } = matchComponents(comps, newNodes(out));
  if (ambiguous) return null;
  const keyOf = comps.map((c, i) => {
    if (assigned[i]) return assigned[i]!.key;
    const key = `~req-${i + 1}`;
    out.push({ op: "add_node", kind: c.stencil, label: c.phrase, key });
    return key;
  });
  const joined = (a: string, b: string) =>
    out.some((o) => o.op === "connect" && ((o.from === a && o.to === b) || (o.from === b && o.to === a)));
  for (const { r, s: si, o: oi } of pairs) {
    const flow = relationFlow(r, getStencil(comps[oi].stencil).simRole);
    const [a, b] = flow.fromSubject ? [keyOf[si], keyOf[oi]] : [keyOf[oi], keyOf[si]];
    if (!joined(a, b)) out.push({ op: "connect", from: a, to: b, kind: flow.kind });
  }
  return out;
}
