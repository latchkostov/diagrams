import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownView } from "./MarkdownView";

describe("MarkdownView component", () => {
  it("renders headings, tables, code blocks, lists, and links", () => {
    const src = `
# System Architecture

| Node | Type |
| :--- | ---: |
| Gateway | Proxy |

- [x] Secured
- [ ] Monitored

\`\`\`json
{ "status": "ok" }
\`\`\`

[Learn more](https://example.com)
`.trim();

    const html = renderToString(<MarkdownView text={src} testId="test-md" />);

    expect(html).toContain('data-testid="test-md"');
    expect(html).toContain('<h1 class="md-h md-h1">System Architecture</h1>');
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('<th style="text-align:left">Node</th>');
    expect(html).toContain('<th style="text-align:right">Type</th>');
    expect(html).toContain('<td style="text-align:left">Gateway</td>');
    expect(html).toContain('class="md-task-checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain('<pre class="md-code-block">');
    expect(html).toContain("{ &quot;status&quot;: &quot;ok&quot; }");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders images and link titles", () => {
    const src = '![Diagram](https://example.com/arch.png "Architecture") and [Home](https://example.com "Homepage")';
    const html = renderToString(<MarkdownView text={src} />);

    expect(html).toContain('src="https://example.com/arch.png"');
    expect(html).toContain('alt="Diagram"');
    expect(html).toContain('title="Architecture"');
    expect(html).toContain('class="md-img"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('title="Homepage"');
  });

  it("renders highlight, subscript, superscript, and heading IDs", () => {
    const src = "### Node API {#node-api}\n\nNotice: ==critical== formula H~2~O and 10^6^.";
    const html = renderToString(<MarkdownView text={src} />);

    expect(html).toContain('<h3 id="node-api" class="md-h md-h3">Node API</h3>');
    expect(html).toContain('<mark class="md-mark">critical</mark>');
    expect(html).toContain('<sub class="md-sub">2</sub>');
    expect(html).toContain('<sup class="md-sup">6</sup>');
  });

  it("renders nested blockquotes and nested lists", () => {
    const src = `
> Main quote
>> Sub quote

- Parent Task
  - Subtask A
  - Subtask B
`.trim();
    const html = renderToString(<MarkdownView text={src} />);

    expect(html).toContain('<blockquote class="md-quote"><p class="md-p">Main quote</p><blockquote class="md-quote">');
    expect(html).toContain('Parent Task</span><ul class="md-list md-ul">');
    expect(html).toContain("Subtask A");
    expect(html).toContain("Subtask B");
  });

  it("returns null for empty text", () => {
    const html = renderToString(<MarkdownView text="" />);
    expect(html).toBe("");
  });
});

describe("MarkdownEditor component", () => {
  it("defaults to Edit mode (textarea visible, no rendered overlay) when value is empty", () => {
    const html = renderToString(
      <MarkdownEditor value="" onChange={() => {}} placeholder="Write docs..." testId="doc-field" />,
    );
    expect(html).toContain('class="md-editor is-editing"');
    expect(html).toContain('data-testid="doc-field"');
    expect(html).not.toContain('data-testid="doc-field-rendered"');
  });

  it("defaults to Preview mode (rendered Markdown overlay visible) when value is non-empty", () => {
    const html = renderToString(
      <MarkdownEditor value="Handles **orders** via `gRPC`." onChange={() => {}} testId="doc-field" />,
    );
    expect(html).toContain('class="md-editor is-preview"');
    expect(html).toContain('data-testid="doc-field-rendered"');
    expect(html).toContain("<strong>orders</strong>");
    expect(html).toContain('<code class="md-inline-code">gRPC</code>');
  });
});
