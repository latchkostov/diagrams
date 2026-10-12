import type { ReportLine } from "./graph";
import { ImportError, isMap, own } from "./yaml";

// `$ref` for the AsyncAPI reader: local references (`#/…`) and references into files opened in the same import.
// Every resolved value keeps the document it came from, so references nested inside it resolve against that
// document, not the one that pointed at it. Remote references are never fetched. Chains, cycles and the total
// number of references followed are bounded, and unread references are reported once each (a Set, not a scan).

export interface Doc {
  file: string;
  root: Record<string, unknown>;
  v2: boolean;
}

/** A value and the document that owns it. `name`: the last pointer segment followed to reach it, if any. */
export interface At {
  value: unknown;
  doc: Doc;
  name?: string;
}

export const REF_LIMITS = { depth: 32, total: 10_000 } as const;
export const REMOTE = "a remote reference, never fetched: open that file too";

const baseName = (path: string) => path.replace(/^.*[\\/]/, "").toLowerCase();
const isRemote = (file: string) => /^[a-z][a-z0-9+.-]*:/i.test(file);

/** Decodes one pointer or reference segment; undefined when it's malformed (`%` without two hex digits). */
export function decodeSegment(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw.replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return undefined;
  }
}

/** A JSON pointer ("/components/messages/OrderPlaced") inside `root`, or undefined. */
function pointerGet(root: unknown, pointer: string): unknown {
  if (!pointer) return root;
  if (!pointer.startsWith("/")) return undefined;
  let cur: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const part = decodeSegment(raw);
    if (part === undefined) return undefined;
    cur = Array.isArray(cur) ? (/^\d+$/.test(part) ? cur[Number(part)] : undefined) : own(cur, part);
    if (cur === undefined) return undefined;
  }
  return cur;
}

export class Refs {
  /** Report lines for references that couldn't be followed, each once. */
  readonly unread: ReportLine[] = [];
  private readonly reported = new Set<string>();
  private followed = 0;

  constructor(private readonly docs: ReadonlyMap<string, Doc>) {}

  report(name: string, reason: string): void {
    const line = name.slice(0, 160);
    if (this.reported.has(line)) return;
    this.reported.add(line);
    this.unread.push({ name: line, reason });
  }

  /** Follows `$ref` chains from `value` (owned by `doc`), keeping the document each step lands in. */
  resolve(value: unknown, doc: Doc): At | undefined {
    const seen = new Set<string>();
    let at: At = { value, doc };
    for (let depth = 0; isMap(at.value) && typeof own(at.value, "$ref") === "string"; depth++) {
      const ref = own(at.value, "$ref") as string;
      if (++this.followed > REF_LIMITS.total) throw new ImportError("It has too many references ($ref) to follow.");
      if (depth >= REF_LIMITS.depth) return void this.report(`$ref ${ref}`, "more than 32 references in a row");
      const hash = ref.indexOf("#");
      const file = hash < 0 ? ref : ref.slice(0, hash);
      const pointer = hash < 0 ? "" : ref.slice(hash + 1);
      let target = at.doc;
      if (file) {
        if (isRemote(file)) return void this.report(`$ref ${ref}`, REMOTE);
        const other = this.docs.get(baseName(file));
        if (!other) return void this.report(`$ref ${ref}`, "not among the files you opened");
        target = other;
      }
      const key = `${target.file}#${pointer}`;
      if (seen.has(key)) return void this.report(`$ref ${ref}`, "a reference cycle");
      seen.add(key);
      const next = pointerGet(target.root, pointer);
      if (next === undefined) return void this.report(`$ref ${ref}`, "points at nothing in the file");
      const last = pointer.slice(pointer.lastIndexOf("/") + 1);
      at = { value: next, doc: target, name: (last && decodeSegment(last)) || at.name };
    }
    return at;
  }

  /** `at.value[key]`, resolved against the document that owns `at`. */
  child(at: At | undefined, key: string): At | undefined {
    return at && this.resolve(own(at.value, key), at.doc);
  }

  /** Lists every remote reference and every reference to a file that wasn't opened, used or not. Iterative. */
  scan(doc: Doc): void {
    const stack: unknown[] = [doc.root];
    while (stack.length) {
      const v = stack.pop();
      if (!v || typeof v !== "object") continue;
      const ref = own(v, "$ref");
      if (typeof ref === "string") {
        const file = ref.split("#")[0];
        if (isRemote(file)) this.report(`$ref ${ref}`, REMOTE);
        else if (file && !this.docs.has(baseName(file))) this.report(`$ref ${ref}`, "not among the files you opened");
      }
      // One push per child: a huge array can't overflow the argument limit.
      if (Array.isArray(v)) for (const child of v) stack.push(child);
      else for (const key of Object.keys(v)) stack.push((v as Record<string, unknown>)[key]);
    }
  }
}
