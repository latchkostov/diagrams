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
function matchLink(
  str: string,
  isImage = false,
): { label: string; href: string; title?: string; length: number } | null {
  const prefix = isImage ? "![" : "[";
  if (!str.startsWith(prefix)) return null;

  const startIdx = prefix.length;
  let bracketDepth = 1;
  let labelEnd = -1;

  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === "\\") {
      i++;
      continue;
    }
    if (str[i] === "[") bracketDepth++;
    else if (str[i] === "]") {
      bracketDepth--;
      if (bracketDepth === 0) {
        labelEnd = i;
        break;
      }
    }
  }

  if (labelEnd === -1 || labelEnd + 1 >= str.length || str[labelEnd + 1] !== "(") return null;

  let parenDepth = 0;
  let urlEnd = -1;
  for (let i = labelEnd + 1; i < str.length; i++) {
    if (str[i] === "\\") {
      i++;
      continue;
    }
    if (str[i] === "(") parenDepth++;
    else if (str[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        urlEnd = i;
        break;
      }
    }
  }

  if (urlEnd === -1) return null;

  const label = str.slice(startIdx, labelEnd);
  const rawUrl = str.slice(labelEnd + 2, urlEnd);
  const { href, title } = parseUrlAndTitle(rawUrl);

  return { label, href, title, length: urlEnd + 1 };
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
export function parseInline(text: string): InlineToken[] {
  if (!text) return [];

  const tokens: InlineToken[] = [];
  let remaining = text;

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
      tokens.push({ type: "boldItalic", children: parseInline(boldItalicMatch[2]) });
      remaining = remaining.slice(boldItalicMatch[0].length);
      continue;
    }

    // 3. Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
    if (boldMatch) {
      tokens.push({ type: "bold", children: parseInline(boldMatch[2]) });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 4. Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~(.+?)~~/);
    if (strikeMatch) {
      tokens.push({ type: "strike", children: parseInline(strikeMatch[1]) });
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // 4b. Subscript: ~text~ (checked after strikethrough ~~)
    const subMatch = remaining.match(/^~([^~\s]+)~/);
    if (subMatch) {
      tokens.push({ type: "subscript", children: parseInline(subMatch[1]) });
      remaining = remaining.slice(subMatch[0].length);
      continue;
    }

    // 4c. Superscript: ^text^
    const supMatch = remaining.match(/^\^([^^\s]+)\^/);
    if (supMatch) {
      tokens.push({ type: "superscript", children: parseInline(supMatch[1]) });
      remaining = remaining.slice(supMatch[0].length);
      continue;
    }

    // 4d. Highlight: ==text==
    const highlightMatch = remaining.match(/^==(.+?)==/);
    if (highlightMatch) {
      tokens.push({ type: "highlight", children: parseInline(highlightMatch[1]) });
      remaining = remaining.slice(highlightMatch[0].length);
      continue;
    }

    // 5. Italic: *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)([^*_]+?)\1/);
    if (italicMatch) {
      tokens.push({ type: "italic", children: parseInline(italicMatch[2]) });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // 6. Image: ![alt](url "title")
    const imgMatch = matchLink(remaining, true);
    if (imgMatch) {
      tokens.push({
        type: "image",
        src: sanitizeUrl(imgMatch.href),
        alt: imgMatch.label,
        title: imgMatch.title,
      });
      remaining = remaining.slice(imgMatch.length);
      continue;
    }

    // 7. Link: [label](url "title") with balanced parentheses
    const linkMatch = matchLink(remaining, false);
    if (linkMatch) {
      tokens.push({
        type: "link",
        href: sanitizeUrl(linkMatch.href),
        title: linkMatch.title,
        children: parseInline(linkMatch.label),
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
): { list: ListBlock; nextIndex: number } {
  let i = startIndex;
  const firstMatch = lines[i].match(/^(\s*)(\d+\.|[-*+])\s+(.*)$/);
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

    const match = line.match(/^(\s*)(\d+\.|[-*+])\s+(.*)$/);
    if (!match) break;

    const indent = match[1].length;
    if (indent < currentIndent) {
      break;
    }

    if (indent > currentIndent) {
      if (items.length > 0) {
        const subResult = parseListBlock(lines, i, indent);
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
      tokens: parseInline(content),
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
export function parseMarkdown(src: string): BlockToken[] {
  if (!src) return [];

  const lines = src.replace(/\r\n/g, "\n").split("\n");
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
    const headingMatch = line.match(/^(#{1,6})\s+(.*?)(?:\s+\{#([a-zA-Z0-9_-]+)\})?$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const rawText = headingMatch[2].trim();
      const id = headingMatch[3];
      blocks.push({
        type: "heading",
        level,
        id,
        tokens: parseInline(rawText),
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
          tokens: parseInline(trimmed),
        });
        i += 2;
        continue;
      }
      if (/^-{2,}$/.test(nextTrimmed)) {
        blocks.push({
          type: "heading",
          level: 2,
          tokens: parseInline(trimmed),
        });
        i += 2;
        continue;
      }
    }

    // 4. Thematic break (horizontal rule): ---, ***, ___
    if (/^(\s*[-*_]\s*){3,}$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // 5. Table: must be followed by delimiter row
    if (trimmed.includes("|") && i + 1 < lines.length) {
      const aligns = parseAlignments(lines[i + 1]);
      if (aligns) {
        const headerCells = splitTableRow(line);
        const headers = headerCells.map((h) => ({ text: h, tokens: parseInline(h) }));
        const rows: { text: string; tokens: InlineToken[] }[][] = [];
        i += 2; // skip header and delimiter

        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
          const cells = splitTableRow(lines[i]);
          const rowCells = headers.map((_, colIdx) => {
            const raw = cells[colIdx] ?? "";
            return { text: raw, tokens: parseInline(raw) };
          });
          rows.push(rowCells);
          i++;
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
        children: parseMarkdown(quoteLines.join("\n")),
      });
      continue;
    }

    // 7. Lists: unordered or ordered (supports nested sublists)
    const listMatch = line.match(/^(\s*)(\d+\.|[-*+])\s+/);
    if (listMatch) {
      const { list, nextIndex } = parseListBlock(lines, i, listMatch[1].length);
      blocks.push(list);
      i = nextIndex;
      continue;
    }

    // 8. Paragraph: accumulate text lines until empty line or next block
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].match(/^(#{1,6}\s+|```|~~~|(\s*[-*_]\s*){3,}$|\s*>|\s*[-*+]\s+|\s*\d+\.\s+)/) &&
      !(paraLines.length > 0 && lines[i].includes("|") && i + 1 < lines.length && parseAlignments(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }

    if (paraLines.length) {
      blocks.push({
        type: "paragraph",
        tokens: parseInline(paraLines.join("\n")),
      });
    }
  }

  return blocks;
}
