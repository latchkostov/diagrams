// Zero-dependency GitHub Flavored Markdown (GFM) AST Parser
// Parses Markdown into structured tokens for direct React rendering.
// 100% CSP compliant: never produces HTML strings, never uses innerHTML.

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineToken[] }
  | { type: "italic"; children: InlineToken[] }
  | { type: "boldItalic"; children: InlineToken[] }
  | { type: "strike"; children: InlineToken[] }
  | { type: "highlight"; children: InlineToken[] }
  | { type: "subscript"; children: InlineToken[] }
  | { type: "superscript"; children: InlineToken[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; title?: string; children: InlineToken[] }
  | { type: "image"; src: string; alt: string; title?: string }
  | { type: "br" };

export type ListItem = {
  text: string;
  tokens: InlineToken[];
  checked?: boolean; // undefined = standard list, true/false = GFM task list checkbox
  subList?: ListBlock;
  subLists?: ListBlock[];
};

export type TableAlign = "left" | "center" | "right";

export type ListBlock = { type: "list"; ordered: boolean; start?: number; items: ListItem[] };

export type BlockToken =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id?: string; tokens: InlineToken[] }
  | {
      type: "table";
      headers: { text: string; tokens: InlineToken[] }[];
      aligns: TableAlign[];
      rows: { text: string; tokens: InlineToken[] }[][];
    }
  | { type: "code"; lang: string; code: string }
  | { type: "blockquote"; children: BlockToken[] }
  | ListBlock
  | { type: "hr" }
  | { type: "paragraph"; tokens: InlineToken[] };

// Shared by block, list and inline parsing, including their combined AST depth.
export const MARKDOWN_LIMITS = { depth: 24, columns: 32, cells: 1024, workPerChar: 128, tokens: 2048 } as const;
export interface MarkdownWork {
  work: number;
}
interface Budget {
  left: number;
  cells: number;
  tokens: number;
  stats?: MarkdownWork;
}
class BudgetExceeded extends Error {}
function spend(budget: Budget, work: number) {
  if (work > budget.left) throw new BudgetExceeded();
  budget.left -= work;
  if (budget.stats) budget.stats.work += work;
}
function budgetFor(text: string, stats?: MarkdownWork): Budget {
  if (stats) stats.work = 0;
  return { left: Math.max(1, text.length) * MARKDOWN_LIMITS.workPerChar, cells: 0, tokens: 0, stats };
}
class OutputExceeded extends BudgetExceeded {}
function emit<T>(budget: Budget, target: T[], ...values: T[]) {
  budget.tokens += values.length;
  if (budget.tokens > MARKDOWN_LIMITS.tokens) throw new OutputExceeded();
  target.push(...values);
}
function literal(text: string): BlockToken[] {
  return [{ type: "paragraph", tokens: [{ type: "text", text }] }];
}
function isThematicBreak(line: string): boolean {
  let count = 0;
  for (const c of line) {
    if (c === "-" || c === "*" || c === "_") count++;
    else if (!/\s/.test(c)) return false;
  }
  return count >= 3;
}
const LIST_LINE = /^([ \t]*)(\d+\.|[-*+])[ \t]+(.*)$/;
const HEADING_LINE = /^(#{1,6})[ \t]+(.*)$/;
function startsBlock(line: string): boolean {
  return (
    HEADING_LINE.test(line) || /^[ \t]*(`{3,}|~{3,}|>)/.test(line) || LIST_LINE.test(line) || isThematicBreak(line)
  );
}

/** Sanitizes a URL to ensure it uses a safe protocol for strict CSP environments. */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    /^https?:\/\//i.test(trimmed) ||
    /^mailto:/i.test(trimmed) ||
    /^data:image\//i.test(trimmed)
  ) {
    return trimmed;
  }
  return "#";
}

/** Parses the inside of `(url "title")` or `(url)` */
function parseUrlAndTitle(raw: string): { href: string; title?: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([^\s]+)(?:\s+["']([^"']+)["'])?$/);
  if (match) {
    return { href: match[1], title: match[2] };
  }
  return { href: trimmed };
}

/** Matches a markdown link [label](url "title") or image ![alt](url "title") supporting balanced parentheses. */
function delimiterPairs(text: string, budget: Budget): Map<number, number> {
  spend(budget, text.length);
  const pairs = new Map<number, number>();
  const brackets: number[] = [];
  const parens: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    const stack = c === "[" || c === "]" ? brackets : parens;
    if (c === "[" || c === "(") stack.push(i);
    else if (c === "]" || c === ")") {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, i);
    }
  }
  return pairs;
}
function matchLink(text: string, start: number, pairs: Map<number, number>, isImage = false) {
  const open = start + (isImage ? 1 : 0);
  if ((isImage && text[start] !== "!") || text[open] !== "[") return null;
  const end = pairs.get(open);
  if (end === undefined || text[end + 1] !== "(") return null;
  const urlEnd = pairs.get(end + 1);
  if (urlEnd === undefined) return null;
  return {
    label: text.slice(open + 1, end),
    ...parseUrlAndTitle(text.slice(end + 2, urlEnd)),
    length: urlEnd + 1 - start,
  };
}

/** Common emoji shortcodes and ASCII emoticon shortcuts. */
const EMOJI_SHORTCODES: Record<string, string> = {
  ":smile:": "😄",
  ":laughing:": "😆",
  ":joy:": "😂",
  ":rofl:": "🤣",
  ":wink:": "😉",
  ":blush:": "😊",
  ":heart_eyes:": "😍",
  ":sunglasses:": "😎",
  ":thinking:": "🤔",
  ":neutral_face:": "😐",
  ":confused:": "😕",
  ":cry:": "😢",
  ":sob:": "😭",
  ":tada:": "🎉",
  ":sparkles:": "✨",
  ":star:": "⭐",
  ":fire:": "🔥",
  ":rocket:": "🚀",
  ":bulb:": "💡",
  ":warning:": "⚠️",
  ":check:": "✅",
  ":white_check_mark:": "✅",
  ":x:": "❌",
  ":question:": "❓",
  ":exclamation:": "❗",
  ":100:": "💯",
  ":+1:": "👍",
  ":-1:": "👎",
  ":thumbsup:": "👍",
  ":thumbsdown:": "👎",
  ":clap:": "👏",
  ":wave:": "👋",
  ":heart:": "❤️",
  ":broken_heart:": "💔",
  ":memo:": "📝",
  ":books:": "📚",
  ":lock:": "🔒",
  ":unlock:": "🔓",
  ":key:": "🔑",
  ":wrench:": "🔧",
  ":gear:": "⚙️",
  ":link:": "🔗",
  ":pin:": "📌",
  ":cloud:": "☁️",
  ":server:": "🖥️",
  ":database:": "🗄️",
  ":package:": "📦",
  ":bug:": "🐛",
  ":eyes:": "👀",
  ":bell:": "🔔",
};

const ASCII_EMOTICONS: [RegExp, string][] = [
  [/(?<=^|\s):-?\)(?=$|\s|[.,!?])/g, "😃"],
  [/(?<=^|\s):-?D(?=$|\s|[.,!?])/g, "😃"],
  [/(?<=^|\s);-?\)(?=$|\s|[.,!?])/g, "😉"],
  [/(?<=^|\s):-?\((?=$|\s|[.,!?])/g, "🙁"],
  [/(?<=^|\s):-?[pP](?=$|\s|[.,!?])/g, "😛"],
  [/(?<=^|\s):-?[oO](?=$|\s|[.,!?])/g, "😮"],
  [/(?<=^|\s)<3(?=$|\s|[.,!?])/g, "❤️"],
];

/** Converts emoji shortcodes (e.g. :rocket:) and ASCII emoticons (e.g. :)) into unicode emojis. */
export function replaceEmojis(text: string): string {
  if (!text) return "";
  let out = text;
  out = out.replace(/:[a-z0-9_+-]+:/gi, (match) => EMOJI_SHORTCODES[match.toLowerCase()] ?? match);
  for (const [regex, emoji] of ASCII_EMOTICONS) {
    out = out.replace(regex, emoji);
  }
  return out;
}

/** Parses inline markdown elements into tokens. */
export function parseInline(text: string, stats?: MarkdownWork): InlineToken[] {
  try {
    return inline(text, budgetFor(text, stats), 0);
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return [{ type: "text", text }];
  }
}
function inline(text: string, budget: Budget, depth: number): InlineToken[] {
  try {
    return scanInline(text, budget, depth);
  } catch (error) {
    // A local work fallback must not discard earlier headings or other blocks.
    if (!(error instanceof BudgetExceeded) || error instanceof OutputExceeded) throw error;
    const tokens: InlineToken[] = [];
    emit(budget, tokens, { type: "text", text });
    return tokens;
  }
}

function scanInline(text: string, budget: Budget, depth: number): InlineToken[] {
  const tokens: InlineToken[] = [];
  if (!text) return tokens;
  if (depth >= MARKDOWN_LIMITS.depth) {
    emit(budget, tokens, { type: "text", text });
    return tokens;
  }
  if (!/[\n`*_~[\\^]|==|https?:\/\//i.test(text)) {
    spend(budget, text.length);
    emit(budget, tokens, { type: "text", text: replaceEmojis(text) });
    return tokens;
  }
  const pairs = delimiterPairs(text, budget);
  const markers = ["`", "***", "___", "**", "__", "~~", "~", "^", "==", "*", "_"];
  // Index each delimiter once. A lookup never rescans the remaining paragraph.
  const ends = new Map<string, Int32Array>();
  for (const marker of markers) {
    const next = new Int32Array(text.length + 1);
    let found = -1;
    next[text.length] = -1;
    for (let at = text.length - 1; at >= 0; at--) {
      if (text.startsWith(marker, at)) found = at;
      next[at] = found;
    }
    spend(budget, text.length);
    ends.set(marker, next);
  }
  const forbidden = new Int32Array(text.length + 1);
  const whitespace = new Int32Array(text.length + 1);
  const newline = new Int32Array(text.length + 1);
  const special = new Int32Array(text.length + 1);
  special[text.length] = text.length;
  forbidden[text.length] = whitespace[text.length] = newline[text.length] = text.length;
  for (let at = text.length - 1; at >= 0; at--) {
    forbidden[at] = /[*_]/.test(text[at]) ? at : forbidden[at + 1];
    whitespace[at] = /\s/.test(text[at]) ? at : whitespace[at + 1];
    newline[at] = text[at] === "\n" ? at : newline[at + 1];
    special[at] =
      /[\n`*_~[\\^]/.test(text[at]) ||
      text.startsWith("![", at) ||
      text.startsWith("==", at) ||
      /^https?:\/\//i.test(text.slice(at, at + 8))
        ? at
        : special[at + 1];
  }
  spend(budget, text.length);
  const pushText = (value: string) => {
    if (!value) return;
    const last = tokens[tokens.length - 1];
    if (last?.type === "text") last.text += value;
    else emit(budget, tokens, { type: "text", text: value });
  };
  const styles = [
    ["***", "boldItalic"],
    ["___", "boldItalic"],
    ["**", "bold"],
    ["__", "bold"],
    ["~~", "strike"],
    ["~", "subscript"],
    ["^", "superscript"],
    ["==", "highlight"],
    ["*", "italic"],
    ["_", "italic"],
  ] as const;
  const autoLink = /https?:\/\/[^\s<)\]]+/iy;
  let cursor = 0;
  while (cursor < text.length) {
    spend(budget, 1);
    const char = text[cursor];
    if (char === "\\" && cursor + 1 < text.length) {
      const next = text[cursor + 1];
      if (next === "\n") {
        emit(budget, tokens, { type: "br" });
        cursor += 2;
        continue;
      }
      if (/[`*_~[\]()#+\-\\!]/.test(next)) {
        pushText(next);
        cursor += 2;
        continue;
      }
    }
    if (char === "`") {
      const close = ends.get("`")![cursor + 1];
      if (close > cursor + 1) {
        emit(budget, tokens, { type: "code", text: text.slice(cursor + 1, close) });
        cursor = close + 1;
        continue;
      }
    }
    let styled = false;
    for (const [marker, type] of styles) {
      if (!text.startsWith(marker, cursor)) continue;
      const begin = cursor + marker.length;
      const narrow = type === "subscript" || type === "superscript" || type === "italic";
      const close = begin < text.length ? ends.get(marker)![begin + (narrow ? 0 : 1)] : -1;
      if (close <= begin || (type !== "italic" && newline[begin] < close)) continue;
      if (type === "italic" && forbidden[begin] < close) continue;
      if ((type === "subscript" || type === "superscript") && whitespace[begin] < close) continue;
      emit(budget, tokens, { type, children: inline(text.slice(begin, close), budget, depth + 1) });
      cursor = close + marker.length;
      styled = true;
      break;
    }
    if (styled) continue;
    if (char === "!" || char === "[") {
      const image = char === "!";
      const link = matchLink(text, cursor, pairs, image);
      if (link) {
        if (image) emit(budget, tokens, { type: "image", src: link.href, alt: link.label, title: link.title });
        else
          emit(budget, tokens, {
            type: "link",
            href: sanitizeUrl(link.href),
            title: link.title,
            children: inline(link.label, budget, depth + 1),
          });
        cursor += link.length;
        continue;
      }
    }
    if (char === "h" || char === "H") {
      autoLink.lastIndex = cursor;
      const match = autoLink.exec(text);
      if (match) {
        const children: InlineToken[] = [];
        emit(budget, children, { type: "text", text: match[0] });
        emit(budget, tokens, { type: "link", href: sanitizeUrl(match[0]), children });
        cursor += match[0].length;
        continue;
      }
    }
    let breakAt = cursor;
    while (text[breakAt] === " ") breakAt++;
    if (text[breakAt] === "\n") {
      emit(budget, tokens, { type: "br" });
      cursor = breakAt + 1;
      continue;
    }
    const stop = special[cursor] === cursor ? cursor + 1 : special[cursor];
    pushText(text.slice(cursor, stop));
    cursor = stop;
  }
  for (const token of tokens) if (token.type === "text") token.text = replaceEmojis(token.text);
  return tokens;
}

/** Splits a table row into cells, handling leading/trailing pipes and escaped pipes \|. */
function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  // Reject expansion before allocating even the split-cell array.
  let columns = 1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") i++;
    else if (trimmed[i] === "|" && ++columns > MARKDOWN_LIMITS.columns) throw new BudgetExceeded();
  }
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "\\" && i + 1 < trimmed.length && trimmed[i + 1] === "|") {
      current += "|";
      i++;
    } else if (trimmed[i] === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += trimmed[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Parses a delimiter row to determine column alignments. */
function parseAlignments(delimiterRow: string): TableAlign[] | null {
  const cells = splitTableRow(delimiterRow);
  if (!cells.length) return null;
  const aligns: TableAlign[] = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c)) return null;
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) aligns.push("center");
    else if (right) aligns.push("right");
    else aligns.push("left");
  }
  return aligns;
}

/** Parses nested or flat list items. */
function parseListBlock(
  lines: string[],
  startIndex: number,
  currentIndent: number,
  budget: Budget,
  depth: number,
): { list: ListBlock; nextIndex: number } {
  let i = startIndex;
  const firstMatch = lines[i].match(LIST_LINE);
  const firstOrdered = Boolean(firstMatch && /^\d+\./.test(firstMatch[2]));
  const startNum = firstOrdered && firstMatch ? parseInt(firstMatch[2], 10) : undefined;
  const items: ListItem[] = [];

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let nextIdx = i + 1;
      while (nextIdx < lines.length && !lines[nextIdx].trim()) {
        nextIdx++;
      }
      if (nextIdx < lines.length) {
        const nextMatch = lines[nextIdx].match(/^(\s*)(\d+\.|[-*+])\s+/);
        if (nextMatch && nextMatch[1].length >= currentIndent) {
          i = nextIdx;
          continue;
        }
      }
      break;
    }

    const match = line.match(LIST_LINE);
    if (!match) break;

    const indent = match[1].length;
    if (indent < currentIndent) {
      break;
    }

    if (indent > currentIndent) {
      if (items.length > 0) {
        if (depth + 1 >= MARKDOWN_LIMITS.depth) {
          const raw = lines.slice(i).join("\n");
          emit(budget, items, { text: raw, tokens: inline(raw, budget, MARKDOWN_LIMITS.depth) });
          i = lines.length;
          break;
        }
        if (++budget.tokens > MARKDOWN_LIMITS.tokens) throw new OutputExceeded();
        const subResult = parseListBlock(lines, i, indent, budget, depth + 1);
        const parent = items[items.length - 1];
        if (!parent.subList) parent.subList = subResult.list;
        else (parent.subLists ??= []).push(subResult.list);
        i = subResult.nextIndex;
        continue;
      }
    }

    let content = match[3];
    let checked: boolean | undefined = undefined;

    const taskMatch = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      checked = taskMatch[1].toLowerCase() === "x";
      content = taskMatch[2];
    }

    emit(budget, items, {
      text: content,
      tokens: inline(content, budget, depth + 1),
      checked,
    });
    i++;
  }

  return {
    list: {
      type: "list",
      ordered: firstOrdered,
      ...(startNum !== undefined && startNum !== 1 ? { start: startNum } : {}),
      items,
    },
    nextIndex: i,
  };
}

/** Parses markdown source into block tokens. */
export function parseMarkdown(src: string, stats?: MarkdownWork): BlockToken[] {
  const normalized = src.replace(/\r\n|[\r\u2028\u2029]/g, "\n");
  try {
    return markdown(normalized, budgetFor(normalized, stats), 0);
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    return literal(normalized);
  }
}
function markdown(src: string, budget: Budget, depth: number): BlockToken[] {
  if (depth >= MARKDOWN_LIMITS.depth) return literal(src);
  spend(budget, src.length);
  if (!src) return [];

  const lines = src.split("\n");
  const blocks: BlockToken[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Fenced Code Block: ```lang or ~~~lang
    const codeMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (codeMatch) {
      const fence = codeMatch[2];
      const lang = codeMatch[3].trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        if (lines[i].trim().startsWith(fence[0].repeat(fence.length))) {
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      emit(budget, blocks, { type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // 2. Heading (ATX): # through ###### with optional {#id}
    const headingMatch = line.match(HEADING_LINE);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      let rawText = headingMatch[2].trim();
      let id: string | undefined;
      const idStart = rawText.lastIndexOf(" {#");
      if (idStart >= 0 && rawText.endsWith("}")) {
        const candidate = rawText.slice(idStart + 3, -1);
        if (/^[a-zA-Z0-9_-]+$/.test(candidate)) {
          id = candidate;
          rawText = rawText.slice(0, idStart).trim();
        }
      }
      emit(budget, blocks, {
        type: "heading",
        level,
        id,
        tokens: inline(rawText, budget, depth + 1),
      });
      i++;
      continue;
    }

    // 3. Setext Headings: text followed by === (H1) or --- (H2)
    if (
      trimmed &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith(">") &&
      !trimmed.startsWith("- ") &&
      !trimmed.startsWith("* ") &&
      !trimmed.startsWith("+ ") &&
      !trimmed.match(/^\d+\.\s/) &&
      !trimmed.includes("|") &&
      i + 1 < lines.length
    ) {
      const nextTrimmed = lines[i + 1].trim();
      if (/^={2,}$/.test(nextTrimmed)) {
        emit(budget, blocks, {
          type: "heading",
          level: 1,
          tokens: inline(trimmed, budget, depth + 1),
        });
        i += 2;
        continue;
      }
      if (/^-{2,}$/.test(nextTrimmed)) {
        emit(budget, blocks, {
          type: "heading",
          level: 2,
          tokens: inline(trimmed, budget, depth + 1),
        });
        i += 2;
        continue;
      }
    }

    // 4. Thematic break (horizontal rule): ---, ***, ___
    if (isThematicBreak(trimmed)) {
      emit(budget, blocks, { type: "hr" });
      i++;
      continue;
    }

    // 5. Table: must be followed by delimiter row
    if (trimmed.includes("|") && i + 1 < lines.length) {
      const aligns = parseAlignments(lines[i + 1]);
      if (aligns) {
        const headerCells = splitTableRow(line);
        let end = i + 2;
        while (end < lines.length && lines[end].trim() && lines[end].includes("|")) end++;
        const cellsNeeded = headerCells.length * (end - i - 1);
        if (
          headerCells.length !== aligns.length ||
          headerCells.length > MARKDOWN_LIMITS.columns ||
          cellsNeeded > MARKDOWN_LIMITS.cells - budget.cells
        ) {
          emit(budget, blocks, ...literal(lines.slice(i, end).join("\n")));
          i = end;
          continue;
        }
        budget.cells += cellsNeeded;
        budget.tokens += cellsNeeded;
        if (budget.tokens > MARKDOWN_LIMITS.tokens) throw new OutputExceeded();
        const headers = headerCells.map((h) => ({ text: h, tokens: inline(h, budget, depth + 1) }));
        const rows: { text: string; tokens: InlineToken[] }[][] = [];
        i += 2;
        while (i < end) {
          const cells = splitTableRow(lines[i++]);
          if (cells.length > headers.length) throw new BudgetExceeded();
          rows.push(
            headers.map((_, col) => {
              const raw = cells[col] ?? "";
              return { text: raw, tokens: inline(raw, budget, depth + 1) };
            }),
          );
        }
        emit(budget, blocks, { type: "table", headers, aligns, rows });
        continue;
      }
    }

    // 6. Blockquote: > text (supports nested blockquotes and blocks inside quote)
    if (line.match(/^\s*>/)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        if (lines[i].match(/^\s*>/)) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        } else if (lines[i].trim() && quoteLines.length > 0) {
          quoteLines.push(lines[i]);
          i++;
        } else {
          break;
        }
      }
      emit(budget, blocks, {
        type: "blockquote",
        children: markdown(quoteLines.join("\n"), budget, depth + 1),
      });
      continue;
    }

    // 7. Lists: unordered or ordered (supports nested sublists)
    const listMatch = line.match(LIST_LINE);
    if (listMatch) {
      const { list, nextIndex } = parseListBlock(lines, i, listMatch[1].length, budget, depth + 1);
      emit(budget, blocks, list);
      i = Math.max(i + 1, nextIndex);
      continue;
    }

    // 8. Paragraph: accumulate text lines until empty line or next block
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !startsBlock(lines[i]) &&
      !(paraLines.length > 0 && lines[i].includes("|") && i + 1 < lines.length && parseAlignments(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }

    if (!paraLines.length) paraLines.push(lines[i++]);
    if (paraLines.length) {
      emit(budget, blocks, {
        type: "paragraph",
        tokens: inline(paraLines.join("\n"), budget, depth + 1),
      });
    }
  }

  return blocks;
}
