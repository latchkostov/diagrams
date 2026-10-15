import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dropdown, type DropdownItem } from "./Dropdown";
import { RELATION_GLYPHS } from "./relationGlyphs";

describe("Dropdown component", () => {
  const items: DropdownItem<string>[] = [
    {
      label: "Flow",
      options: [
        { value: "message", label: "Message", icon: "rel-message", hint: "async" },
        { value: "request", label: "Request", icon: "rel-request", hint: "sync" },
      ],
    },
    {
      label: "Dependency",
      options: [
        { value: "config", label: "Config", icon: "rel-config", className: "fe-rel-config" },
        { value: "secret", label: "Secret", icon: "rel-secret", className: "fe-rel-secret" },
      ],
    },
  ];

  it("renders trigger with selected value and icon", () => {
    const html = renderToString(
      <Dropdown
        value="secret"
        onChange={() => undefined}
        items={items}
        testId="inspector-field-relation"
        aria-label="Relationship"
      />,
    );
    expect(html).toContain('data-testid="inspector-field-relation"');
    expect(html).toContain('value="secret"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Secret");
    expect(html).toContain("dropdown-lead fe-rel-secret");
    expect(html).toContain(`d="${RELATION_GLYPHS["rel-secret"]}"`);
    expect(html).toContain("aria-describedby=");
  });

  it("renders placeholder when value is undefined", () => {
    const html = renderToString(
      <Dropdown
        value={undefined}
        onChange={() => undefined}
        items={items}
        placeholder="Mixed"
        aria-label="Relationship of 2 edges"
        testId="inspector-field-relation"
      />,
    );
    expect(html).toContain('data-testid="inspector-field-relation"');
    expect(html).toContain('value=""');
    expect(html).toContain("Mixed");
    expect(html).toContain("aria-describedby=");
  });

  it("renders custom trigger when renderTrigger is provided", () => {
    const html = renderToString(
      <Dropdown
        value="message"
        onChange={() => undefined}
        items={items}
        aria-label="Relationship"
        renderTrigger={(selected) => <span className="custom-trigger">{selected?.label}</span>}
      />,
    );
    expect(html).toContain('class="custom-trigger"');
    expect(html).toContain("Message");
    expect(html).toMatch(/<span id="[^"]+" class="sr-only">Message<\/span>/);
  });
});
