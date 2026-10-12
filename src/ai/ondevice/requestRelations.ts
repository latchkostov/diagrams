// What a request says about how things connect, read once and shared by every repair that needs it
// (direction repair in compactOps.ts, completion in replyChecks.ts): each clause's verb, its subject and
// object phrases, whether it's negated, and, given the two ends' roles, which way the data flows and
// whether it's a message or a request.

import type { SimRole } from "../../model/types";
import { splitClauses } from "./requestClauses";

/** Consume-type verbs: the data flows from the object to the subject ("Java consumes a topic"). */
export const CONSUMES =
  /\b(?:consumes?|consuming|reads? from|subscribes? to|listens? (?:to|on)|pulls? from|(?:is )?fed by|(?:is )?triggered by)\b/i;
/** Passive consume: "X consumed by Y" is Y consuming X. */
const CONSUMED_BY = /\b(?:is |are )?(?:consumed|read)\s+by\b/i;
/** Produce-type verbs: the data flows from the subject to the object ("A Lambda saves objects into S3"). */
export const PRODUCES =
  /\b(?:writes?(?: \w+)? (?:to|into)|writes|persists?(?: \w+)? (?:to|into|in)|saves?(?: \w+)? (?:to|into|in)|stores?(?: \w+)? (?:in|into)|sends?(?: \w+)? to|publish(?:es)?(?: \w+)? (?:to|into)|routes? to|calls|invokes|feeds|exports? to|forwards?(?: \w+)? to|delivers|starts|accesses|uses|queries|connects to|fans? out (?:toward|to))\b/i;
/** A request call rather than a message, whatever the target: "calls", "uses", "queries", "accesses". */
const REQUEST_VERB = /\b(?:calls|uses|queries|accesses|reads? from)\b/i;
export { NEGATION } from "./requestClauses";

/** Where clauses break, besides punctuation (requestClauses.ts): conjunctions and relative pronouns. */
const JOINERS: ReadonlySet<string> = new Set(["and", "but", "then", "which", "that", "who", "while"]);

export interface RequestRelation {
  /** The words naming the subject (inherited for "…and reads from C" or "…which writes to D"). */
  subject: string;
  object: string;
  /** Consume-type ("consumes", "reads from", "consumed by"): the data comes from the object. */
  consume: boolean;
  /** The verb as written. */
  verb: string;
  /** The clause says not to ("…but don't connect it", "without…"). */
  negated: boolean;
}

/**
 * Each clause's relation. A clause without its own subject takes it from the clause before: the subject
 * after "and" or a comma ("A writes to B and reads from C": A reads from C), the object after "which",
 * "that" or "who" ("X consumed by Y which writes to Z": Y writes to Z).
 */
export function requestRelations(request: string): RequestRelation[] {
  return parseRelations(request).relations;
}

/**
 * Does every clause of the request relate two things the way requestRelations reads them? False when a
 * clause has a verb it doesn't know ("…and API responds to Client"): what that clause says is unknown,
 * so nothing may be removed on the strength of its silence.
 */
export function relationsCoverRequest(request: string): boolean {
  const { relations, unread } = parseRelations(request);
  return relations.length > 0 && unread === 0;
}

function parseRelations(request: string): { relations: RequestRelation[]; unread: number } {
  const out: RequestRelation[] = [];
  let unread = 0;
  let lastSubject = "";
  let lastObject = "";
  for (const { text: clause, joiner, negated } of splitClauses(request, JOINERS)) {
    const passive = CONSUMED_BY.exec(clause);
    const consume = passive ? null : CONSUMES.exec(clause);
    const produce = passive || consume ? null : PRODUCES.exec(clause);
    const m = passive ?? consume ?? produce;
    if (!m) {
      unread++;
      continue;
    }
    let subject = clause.slice(0, m.index).trim();
    const object = clause.slice(m.index + m[0].length).trim();
    if (!subject) subject = /^(which|that|who)$/.test(joiner) ? lastObject : lastSubject;
    // "X consumed by Y": Y consumes X.
    const rel: RequestRelation = passive
      ? { subject: object, object: subject, consume: true, verb: m[0], negated }
      : { subject, object, consume: !!consume, verb: m[0], negated };
    out.push(rel);
    // "and" goes on with the clause's subject as written; "which" with its last noun, after the verb.
    lastSubject = subject;
    lastObject = object;
  }
  return { relations: out, unread };
}

const MESSAGING: readonly SimRole[] = ["queue", "topic", "stream"];

/**
 * Which way a relation's data flows, and as what, given its object's role:
 * - consuming from a queue, topic or stream: object -> subject, a message;
 * - "reads from" a database or cache: still subject -> object, a request (the service calls it);
 * - anything else consumed ("is triggered by X"): object -> subject, a message;
 * - produce verbs: subject -> object; a request into a store or for "calls / uses / queries /
 *   accesses", a message into a queue, topic or stream, otherwise a message.
 */
export function relationFlow(
  rel: Pick<RequestRelation, "consume" | "verb">,
  objectRole: SimRole | undefined,
): { fromSubject: boolean; kind: "sync" | "async" } {
  const intoStore = objectRole === "store";
  const messaging = !!objectRole && MESSAGING.includes(objectRole);
  if (rel.consume) {
    if (intoStore) return { fromSubject: true, kind: "sync" };
    return { fromSubject: false, kind: "async" };
  }
  if (messaging) return { fromSubject: true, kind: "async" };
  if (intoStore || REQUEST_VERB.test(rel.verb)) return { fromSubject: true, kind: "sync" };
  return { fromSubject: true, kind: "async" };
}
