// A request split into clauses, the same way for every reader: the relations (requestRelations.ts), the
// renames and kind changes (requestEdits.ts) and "between". It is a small tokenizer, linear in the
// request's length, with no backtracking regex: a request pasted into the box runs on the main thread.
// A quoted name ("Billing and Shipping", "Billing, v2") is one token, never a clause boundary, and each
// clause knows whether it's negated ("don't rename…", "not a MongoDB").

/** "not", "never", "without", "don't connect", "unconnected", "leave it…": nothing may be inferred. */
export const NEGATION =
  /\b(?:not|never|no|without|n't|nor)\b|n't\b|\b(?:un|dis)connected\b|\bstand-?alone\b|\bon its own\b|\bleave\b/i;

export interface Token {
  /** The word as written; a quoted name without its quotes; or the punctuation mark. */
  text: string;
  kind: "word" | "quoted" | "punct";
  /** Where it is in the request (quotes included). */
  start: number;
  end: number;
}

/** Opening quote → closing quote. A plain apostrophe isn't one ("don't", "Bob's"). */
const QUOTES: Readonly<Record<string, string>> = { '"': '"', "“": "”", "‘": "’" };
const SPACE = /\s/;

/**
 * Words, quoted names and clause punctuation (",", ";", and "." before a space or the end; ".NET" and
 * "orders.created" stay words). A quote opens only at a word's start and needs its closing quote;
 * without one it is part of the word.
 */
export function tokenize(request: string): Token[] {
  const out: Token[] = [];
  const unclosed = new Set<string>();
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0) out.push({ text: request.slice(start, end), kind: "word", start, end });
    start = -1;
  };
  for (let i = 0; i < request.length; i++) {
    const c = request[i];
    if (SPACE.test(c)) {
      flush(i);
      continue;
    }
    const closer = start < 0 ? QUOTES[c] : undefined;
    if (closer && !unclosed.has(closer)) {
      const close = request.indexOf(closer, i + 1);
      // Remembered, so many openers without a closer stay linear.
      if (close < 0) unclosed.add(closer);
      else {
        out.push({ text: request.slice(i + 1, close), kind: "quoted", start: i, end: close + 1 });
        i = close;
        continue;
      }
    }
    if (c === "," || c === ";" || (c === "." && (i + 1 === request.length || SPACE.test(request[i + 1])))) {
      flush(i);
      out.push({ text: c, kind: "punct", start: i, end: i + 1 });
      continue;
    }
    if (start < 0) start = i;
  }
  flush(request.length);
  return out;
}

export interface Clause {
  /** The clause as written: a slice of the request, quotes included. */
  text: string;
  tokens: Token[];
  /** What came before it: ",", ";", ".", a joining word in lower case, or "" at the start. */
  joiner: string;
  /** A negation outside quoted names ("Do not rename…", "…but not a MongoDB"). */
  negated: boolean;
}

/** A token's word in lower case ("" for a quoted name or punctuation). */
export const wordOf = (t: Token | undefined) => (t?.kind === "word" ? t.text.toLowerCase() : "");

/**
 * The request's clauses, split at clause punctuation and at the joining words in `joiners` (outside
 * quotes). With `splits`, a joining word splits only where the piece after it passes ("…and make X a
 * Y" does, "Billing and Shipping" doesn't): otherwise the piece stays in the clause before.
 */
export function splitClauses(
  request: string,
  joiners: ReadonlySet<string>,
  splits?: (piece: readonly Token[]) => boolean,
): Clause[] {
  const tokens = tokenize(request);
  const pieces: { joiner: string; joinToken?: Token; hard: boolean; tokens: Token[] }[] = [];
  let joiner = "";
  let joinToken: Token | undefined;
  /** Punctuation since the last piece: always a boundary. */
  let hard = false;
  let current: Token[] = [];
  const close = () => {
    if (current.length) {
      pieces.push({ joiner, joinToken, hard, tokens: current });
      hard = false;
      joinToken = undefined;
    }
    current = [];
  };
  for (const t of tokens) {
    const w = wordOf(t);
    if (t.kind === "punct" || joiners.has(w)) {
      close();
      joiner = t.kind === "punct" ? t.text : w;
      if (t.kind === "punct") hard = true;
      else joinToken = t;
      continue;
    }
    current.push(t);
  }
  close();
  const clauses: { joiner: string; tokens: Token[] }[] = [];
  for (const p of pieces) {
    const prev = clauses[clauses.length - 1];
    // A joining word that doesn't start a new clause here is part of the one before.
    if (prev && !p.hard && p.joinToken && splits && !splits(p.tokens)) prev.tokens.push(p.joinToken, ...p.tokens);
    else clauses.push({ joiner: p.joiner, tokens: [...p.tokens] });
  }
  return clauses.map((c) => ({
    text: request.slice(c.tokens[0].start, c.tokens[c.tokens.length - 1].end),
    tokens: c.tokens,
    joiner: c.joiner,
    negated: NEGATION.test(
      c.tokens
        .filter((t) => t.kind !== "quoted")
        .map((t) => t.text)
        .join(" "),
    ),
  }));
}
