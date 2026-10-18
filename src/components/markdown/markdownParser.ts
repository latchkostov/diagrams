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
export const MARKDOWN_LIMITS = { depth: 24, columns: 32, cells: 1024, workPerChar: 128 } as const;
export interface MarkdownWork {
  work: number;
}
interface Budget {
  left: number;
  cells: number;
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
  return { left: Math.max(1, text.length) * MARKDOWN_LIMITS.workPerChar, cells: 0, stats };
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
  if (depth >= MARKDOWN_LIMITS.depth) return [{ type: "text", text }];
  if (!text) return [];

  const tokens: InlineToken[] = [];
  let remaining = text;
  const pairs = delimiterPairs(text, budget);

  const pushText = (str: string) => {
    if (!str) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === "text") {
      last.text += str;
    } else {
      tokens.push({ type: "text", text: str });
    }
  };

  while (remaining.length > 0) {
    spend(budget, remaining.length);
    // 0. Hard line break via backslash + newline: \\\n
    if (remaining.startsWith("\\\n")) {
      tokens.push({ type: "br" });
      remaining = remaining.slice(2);
      continue;
    }

    // 0b. Escaped characters: \* \_ \[ \] \( \) \` \# \+ \- \~ \\ \!
    if (remaining.startsWith("\\") && remaining.length > 1) {
      const nextChar = remaining[1];
      if (/[`*_~[\]()#+\-\\!]/.test(nextChar)) {
        pushText(nextChar);
        remaining = remaining.slice(2);
        continue;
      }
    }

    // 1. Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      tokens.push({ type: "code", text: codeMatch[1] });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 2. Bold + Italic: ***text*** or ___text___
    const boldItalicMatch = remaining.match(/^(\*\*\*|___)(.+?)\1/);
    if (boldItalicMatch) {
      tokens.push({ type: "boldItalic", children: inline(boldItalicMatch[2], budget, depth + 1) });
      remaining = remaining.slice(boldItalicMatch[0].length);
      continue;
    }

    // 3. Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
    if (boldMatch) {
      tokens.push({ type: "bold", children: inline(boldMatch[2], budget, depth + 1) });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 4. Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~(.+?)~~/);
    if (strikeMatch) {
      tokens.push({ type: "strike", children: inline(strikeMatch[1], budget, depth + 1) });
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // 4b. Subscript: ~text~ (checked after strikethrough ~~)
    const subMatch = remaining.match(/^~([^~\s]+)~/);
    if (subMatch) {
      tokens.push({ type: "subscript", children: inline(subMatch[1], budget, depth + 1) });
      remaining = remaining.slice(subMatch[0].length);
      continue;
    }

    // 4c. Superscript: ^text^
    const supMatch = remaining.match(/^\^([^^\s]+)\^/);
    if (supMatch) {
      tokens.push({ type: "superscript", children: inline(supMatch[1], budget, depth + 1) });
      remaining = remaining.slice(supMatch[0].length);
      continue;
    }

    // 4d. Highlight: ==text==
    const highlightMatch = remaining.match(/^==(.+?)==/);
    if (highlightMatch) {
      tokens.push({ type: "highlight", children: inline(highlightMatch[1], budget, depth + 1) });
      remaining = remaining.slice(highlightMatch[0].length);
      continue;
    }

    // 5. Italic: *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)([^*_]+?)\1/);
    if (italicMatch) {
      tokens.push({ type: "italic", children: inline(italicMatch[2], budget, depth + 1) });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // 6. Image: ![alt](url "title")
    const imgMatch = matchLink(text, text.length - remaining.length, pairs, true);
    if (imgMatch) {
      tokens.push({
        type: "image",
        src: imgMatch.href,
        alt: imgMatch.label,
        title: imgMatch.title,
      });
      remaining = remaining.slice(imgMatch.length);
      continue;
    }

    // 7. Link: [label](url "title") with balanced parentheses
    const linkMatch = matchLink(text, text.length - remaining.length, pairs, false);
    if (linkMatch) {
      tokens.push({
        type: "link",
        href: sanitizeUrl(linkMatch.href),
        title: linkMatch.title,
        children: inline(linkMatch.label, budget, depth + 1),
      });
      remaining = remaining.slice(linkMatch.length);
      continue;
    }

    // 8. Autolink: https://... or http://...
    const autoLinkMatch = remaining.match(/^(https?:\/\/[^\s<)\]]+)/i);
    if (autoLinkMatch) {
      const url = autoLinkMatch[1];
      tokens.push({
        type: "link",
        href: sanitizeUrl(url),
        children: [{ type: "text", text: url }],
      });
      remaining = remaining.slice(url.length);
      continue;
    }

    // 9. Line break inside paragraph (GFM soft/hard break)
    const brMatch = remaining.match(/^ *\n/);
    if (brMatch) {
      tokens.push({ type: "br" });
      remaining = remaining.slice(brMatch[0].length);
      continue;
    }

    // 10. Plain text up to next special character
    const specialIndex = remaining.search(/[\n`*_~[\\]|!\[|\^|==|https?:\/\//i);
    if (specialIndex === -1) {
      pushText(remaining);
      break;
    } else if (specialIndex === 0) {
      // Character didn't match any syntax, consume 1 char as plain text
      pushText(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      pushText(remaining.slice(0, specialIndex));
      remaining = remaining.slice(specialIndex);
    }
  }

  // Replace emoji shortcodes and emoticons in text tokens
  for (const t of tokens) {
    if (t.type === "text") {
      t.text = replaceEmojis(t.text);
    }
  }

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
          items.push({ text: raw, tokens: [{ type: "text", text: raw }] });
          i = lines.length;
          break;
        }
        const subResult = parseListBlock(lines, i, indent, budget, depth + 1);
        items[items.length - 1].subList = subResult.list;
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

    items.push({
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
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
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
      blocks.push({
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
        blocks.push({
          type: "heading",
          level: 1,
          tokens: inline(trimmed, budget, depth + 1),
        });
        i += 2;
        continue;
      }
      if (/^-{2,}$/.test(nextTrimmed)) {
        blocks.push({
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
      blocks.push({ type: "hr" });
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
          blocks.push(...literal(lines.slice(i, end).join("\n")));
          i = end;
          continue;
        }
        budget.cells += cellsNeeded;
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
        blocks.push({ type: "table", headers, aligns, rows });
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
      blocks.push({
        type: "blockquote",
        children: markdown(quoteLines.join("\n"), budget, depth + 1),
      });
      continue;
    }

    // 7. Lists: unordered or ordered (supports nested sublists)
    const listMatch = line.match(LIST_LINE);
    if (listMatch) {
      const { list, nextIndex } = parseListBlock(lines, i, listMatch[1].length, budget, depth + 1);
      blocks.push(list);
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
      blocks.push({
        type: "paragraph",
        tokens: inline(paraLines.join("\n"), budget, depth + 1),
      });
    }
  }

  return blocks;
}
