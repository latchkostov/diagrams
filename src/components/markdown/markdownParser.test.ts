import { describe, expect, it, vi } from "vitest";
import { parseMarkdown, parseInline, sanitizeUrl } from "./markdownParser";

describe("markdownParser", () => {
  describe("sanitizeUrl", () => {
    it("allows https, http, mailto, anchor, and relative paths", () => {
      expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
      expect(sanitizeUrl("http://example.com/api")).toBe("http://example.com/api");
      expect(sanitizeUrl("mailto:user@example.com")).toBe("mailto:user@example.com");
      expect(sanitizeUrl("#section-1")).toBe("#section-1");
      expect(sanitizeUrl("/docs/intro")).toBe("/docs/intro");
    });

    it("blocks javascript: and hostile schemes", () => {
      expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
      expect(sanitizeUrl("javascript:/*evil*/")).toBe("#");
      expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
      expect(sanitizeUrl("vbscript:msgbox")).toBe("#");
    });
  });

  describe("parseInline", () => {
    it("parses bold and italic formatting", () => {
      const tokens = parseInline("Hello **bold** and *italic* and ***both***");
      expect(tokens).toEqual([
        { type: "text", text: "Hello " },
        { type: "bold", children: [{ type: "text", text: "bold" }] },
        { type: "text", text: " and " },
        { type: "italic", children: [{ type: "text", text: "italic" }] },
        { type: "text", text: " and " },
        { type: "boldItalic", children: [{ type: "text", text: "both" }] },
      ]);
    });

    it("parses strikethrough and inline code", () => {
      const tokens = parseInline("This is ~~wrong~~ and `const x = 1`");
      expect(tokens).toEqual([
        { type: "text", text: "This is " },
        { type: "strike", children: [{ type: "text", text: "wrong" }] },
        { type: "text", text: " and " },
        { type: "code", text: "const x = 1" },
      ]);
    });

    it("parses links and sanitizes unsafe links", () => {
      const tokens = parseInline("[Docs](https://example.com) and [Attack](javascript:alert(1))");
      expect(tokens).toEqual([
        {
          type: "link",
          href: "https://example.com",
          children: [{ type: "text", text: "Docs" }],
        },
        { type: "text", text: " and " },
        {
          type: "link",
          href: "#",
          children: [{ type: "text", text: "Attack" }],
        },
      ]);
    });

    it("preserves single and escaped line breaks inside paragraphs", () => {
      const tokens = parseInline("First line\nSecond line\\\nThird line");
      expect(tokens).toEqual([
        { type: "text", text: "First line" },
        { type: "br" },
        { type: "text", text: "Second line" },
        { type: "br" },
        { type: "text", text: "Third line" },
      ]);
    });
  });

  describe("parseMarkdown blocks", () => {
    it("parses headings H1 through H6", () => {
      const src = "# Title\n## Subtitle\n### Section";
      const blocks = parseMarkdown(src);
      expect(blocks).toEqual([
        {
          type: "heading",
          level: 1,
          tokens: [{ type: "text", text: "Title" }],
        },
        {
          type: "heading",
          level: 2,
          tokens: [{ type: "text", text: "Subtitle" }],
        },
        {
          type: "heading",
          level: 3,
          tokens: [{ type: "text", text: "Section" }],
        },
      ]);
    });

    it("parses GFM tables with column alignments", () => {
      const src = `
| Service | Role | Status |
| :--- | :---: | ---: |
| Auth | API | Active |
| Orders | Worker | Idle |
`.trim();
      const blocks = parseMarkdown(src);
      expect(blocks).toHaveLength(1);
      const table = blocks[0];
      expect(table.type).toBe("table");
      if (table.type === "table") {
        expect(table.headers.map((h) => h.text)).toEqual(["Service", "Role", "Status"]);
        expect(table.aligns).toEqual(["left", "center", "right"]);
        expect(table.rows).toHaveLength(2);
        expect(table.rows[0].map((c) => c.text)).toEqual(["Auth", "API", "Active"]);
        expect(table.rows[1].map((c) => c.text)).toEqual(["Orders", "Worker", "Idle"]);
      }
    });

    it("parses fenced code blocks", () => {
      const src = "```typescript\nconst add = (a: number, b: number) => a + b;\n```";
      const blocks = parseMarkdown(src);
      expect(blocks).toEqual([
        {
          type: "code",
          lang: "typescript",
          code: "const add = (a: number, b: number) => a + b;",
        },
      ]);
    });

    it("parses blockquotes", () => {
      const src = "> Important architectural decision:\n> Use event sourcing.";
      const blocks = parseMarkdown(src);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("blockquote");
    });

    it("parses standard and task lists", () => {
      const src = `
- [x] Schema designed
- [ ] UI implemented
- Plain item
`.trim();
      const blocks = parseMarkdown(src);
      expect(blocks).toHaveLength(1);
      const list = blocks[0];
      expect(list.type).toBe("list");
      if (list.type === "list") {
        expect(list.ordered).toBe(false);
        expect(list.items).toHaveLength(3);
        expect(list.items[0].checked).toBe(true);
        expect(list.items[0].text).toBe("Schema designed");
        expect(list.items[1].checked).toBe(false);
        expect(list.items[1].text).toBe("UI implemented");
        expect(list.items[2].checked).toBeUndefined();
        expect(list.items[2].text).toBe("Plain item");
      }
    });

    it("parses horizontal rules", () => {
      const src = "Above\n\n---\n\nBelow";
      const blocks = parseMarkdown(src);
      expect(blocks).toHaveLength(3);
      expect(blocks[1].type).toBe("hr");
    });

    it("parses setext headings", () => {
      const src = "Major Title\n===\n\nSub Section\n---";
      const blocks = parseMarkdown(src);
      expect(blocks).toEqual([
        {
          type: "heading",
          level: 1,
          tokens: [{ type: "text", text: "Major Title" }],
        },
        {
          type: "heading",
          level: 2,
          tokens: [{ type: "text", text: "Sub Section" }],
        },
      ]);
    });
  });

  describe("extended basic inline features", () => {
    it("parses links with titles", () => {
      const tokens = parseInline('[Docs](https://example.com "Architecture Guide")');
      expect(tokens).toEqual([
        {
          type: "link",
          href: "https://example.com",
          title: "Architecture Guide",
          children: [{ type: "text", text: "Docs" }],
        },
      ]);
    });

    it("parses images with alt and title", () => {
      const tokens = parseInline('![Cluster](https://example.com/k8s.png "Kubernetes")');
      expect(tokens).toEqual([
        {
          type: "image",
          src: "https://example.com/k8s.png",
          alt: "Cluster",
          title: "Kubernetes",
        },
      ]);
    });

    it("parses backslash-escaped markdown characters", () => {
      const tokens = parseInline("\\*not italic\\* and \\`not code\\` and \\[not link\\]");
      expect(tokens).toEqual([{ type: "text", text: "*not italic* and `not code` and [not link]" }]);
    });

    it("parses highlight, subscript, and superscript", () => {
      const tokens = parseInline("==important== and H~2~O and X^2^");
      expect(tokens).toEqual([
        {
          type: "highlight",
          children: [{ type: "text", text: "important" }],
        },
        { type: "text", text: " and H" },
        {
          type: "subscript",
          children: [{ type: "text", text: "2" }],
        },
        { type: "text", text: "O and X" },
        {
          type: "superscript",
          children: [{ type: "text", text: "2" }],
        },
      ]);
    });

    it("replaces ASCII emoticons and emoji shortcodes in text", () => {
      const tokens = parseInline("Hello :) and :rocket: and :warning: and :+1: and <3");
      expect(tokens).toEqual([
        {
          type: "text",
          text: "Hello 😃 and 🚀 and ⚠️ and 👍 and ❤️",
        },
      ]);
    });
  });

  describe("advanced structure and variations", () => {
    it("parses headings with custom IDs", () => {
      const src = "### System Overview {#overview}\n\n#### Security {#sec-policy}";
      const blocks = parseMarkdown(src);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({
        type: "heading",
        level: 3,
        id: "overview",
        tokens: [{ type: "text", text: "System Overview" }],
      });
      expect(blocks[1]).toMatchObject({
        type: "heading",
        level: 4,
        id: "sec-policy",
        tokens: [{ type: "text", text: "Security" }],
      });
    });

    it("parses nested blockquotes", () => {
      const src = "> Outer quote\n>> Inner nested quote";
      const blocks = parseMarkdown(src);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("blockquote");
      if (blocks[0].type === "blockquote") {
        expect(blocks[0].children).toHaveLength(2);
        expect(blocks[0].children[0].type).toBe("paragraph");
        expect(blocks[0].children[1].type).toBe("blockquote");
        if (blocks[0].children[1].type === "blockquote") {
          expect(blocks[0].children[1].children[0].type).toBe("paragraph");
        }
      }
    });

    it("parses nested lists with mixed ordered and unordered levels", () => {
      const src = `
- Architecture
  - Frontend (React)
  - Backend (Node)
- Deployment
  1. Build Docker image
  2. Deploy to K8s
`.trim();
      const blocks = parseMarkdown(src);
      expect(blocks).toHaveLength(1);
      const list = blocks[0];
      expect(list.type).toBe("list");
      if (list.type === "list") {
        expect(list.ordered).toBe(false);
        expect(list.items).toHaveLength(2);

        // Architecture item with sublist
        expect(list.items[0].text).toBe("Architecture");
        expect(list.items[0].subList?.ordered).toBe(false);
        expect(list.items[0].subList?.items).toHaveLength(2);
        expect(list.items[0].subList?.items[0].text).toBe("Frontend (React)");

        // Deployment item with ordered sublist
        expect(list.items[1].text).toBe("Deployment");
        expect(list.items[1].subList?.ordered).toBe(true);
        expect(list.items[1].subList?.items).toHaveLength(2);
        expect(list.items[1].subList?.items[0].text).toBe("Build Docker image");
      }
    });

    it("parses tables with escaped pipe characters", () => {
      const src = `
| Symbol | Meaning |
| --- | --- |
| \\| | Bitwise OR / pipe |
`.trim();
      const blocks = parseMarkdown(src);
      expect(blocks).toHaveLength(1);
      const table = blocks[0];
      expect(table.type).toBe("table");
      if (table.type === "table") {
        expect(table.rows).toHaveLength(1);
        expect(table.rows[0][0].text).toBe("|");
        expect(table.rows[0][1].text).toBe("Bitwise OR / pipe");
      }
    });
  });
});

describe("Markdown review regressions", () => {
  it("renders hundreds of formatted spans without losing preceding blocks", () => {
    const blocks = parseMarkdown("# Runbook\n\n" + Array(300).fill("**service**").join(" "));
    expect(blocks[0].type).toBe("heading");
    expect(blocks[1].type === "paragraph" && blocks[1].tokens.filter((t) => t.type === "bold")).toHaveLength(300);
  });
  it("keeps nested items when indentation decreases, including mixed list kinds", () => {
    const blocks = parseMarkdown("- parent\n    - first\n  1. second");
    expect(JSON.stringify(blocks)).toContain("first");
    expect(JSON.stringify(blocks)).toContain("second");
  });
});

it.each(["~~~[x](https://example.com)~", "*a\nb*", "a  \nb", "**a** \nb"])(
  "keeps inline scanning semantics for %j",
  (source) => {
    const tokens = parseInline(source);
    if (source.startsWith("~~~")) expect(tokens[0]).toEqual({ type: "text", text: "~~" });
    else if (source.startsWith("*a")) expect(tokens[0].type).toBe("italic");
    else if (source.startsWith("a")) expect(tokens[0]).toEqual({ type: "text", text: "a  " });
    else expect(tokens[1]).toEqual({ type: "br" });
  },
);

it("skips delimiter indexes for plain text while preserving emoji replacement", () => {
  const indexes = vi.spyOn(globalThis, "Int32Array");
  try {
    expect(parseInline("plain :rocket:")).toEqual([{ type: "text", text: "plain 🚀" }]);
    expect(indexes).not.toHaveBeenCalled();
  } finally {
    indexes.mockRestore();
  }
});
