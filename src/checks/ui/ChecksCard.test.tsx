// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChecksCard, InspectorFindings } from "./ChecksCard";
import { FindingRow } from "./FindingRow";
import type { RowHost } from "./FindingRow";
import type { Finding } from "../types";

const finding = (id: string, severity: Finding["severity"] = "warning"): Finding => ({
  id,
  rule: "no-reader",
  target: id,
  elements: [id],
  severity,
  title: "Nobody reads this topic",
  message: "Add a consumer.",
  rationale: "Published messages need a reader.",
});
const host = {
  editor: { getDiagram: () => ({}) } as RowHost["editor"],
  reveal: vi.fn(),
  open: vi.fn(),
};
const state = { name: (id: string) => id, stale: false };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const byTestId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("R-f37e3018ec keeps focus inside docked Checks when the last finding disappears", async () => {
  const render = (findings: Finding[]) =>
    root.render(
      <ChecksCard
        {...host}
        placement="dock"
        state={state}
        result={{ findings, ignored: [], off: [], ran: ["no-reader"] }}
        top={0}
        onClose={vi.fn()}
        returnFocus={vi.fn()}
      />,
    );
  await act(() => render([finding("last")]));
  byTestId("check-select-last").focus();
  expect(document.activeElement).toBe(byTestId("check-select-last"));
  await act(() => render([]));
  expect(document.activeElement).toBe(byTestId("checks-card"));
  expect(byTestId("checks-card").tabIndex).toBe(-1);
});

// quarantined: diagram-scope diagnostics, see docs/backlog/2026-10-25-diagram-scope-findings.md
it.skip("keeps diagram diagnostics and guidance reachable without element actions", async () => {
  const diagnostic: Finding = {
    ...finding("message-loop:incomplete"),
    rule: "message-loop",
    scope: "diagram",
    target: "",
    elements: [],
    title: "Message type propagation incomplete",
    message: "Timeline forwarding edits cannot be analyzed completely.",
    rationale: "Review message paths before and after timeline forwarding edits manually.",
  };
  await act(() => root.render(<FindingRow finding={diagnostic} host={host} state={state} />));
  expect(byTestId("check-row-message-loop:incomplete").textContent).toContain(diagnostic.message);
  expect(byTestId("check-select-message-loop:incomplete")).toBeNull();
  expect(byTestId("check-why-message-loop:incomplete").textContent).toContain(diagnostic.rationale);
  await act(() => byTestId("check-more-message-loop:incomplete").click());
  expect(byTestId("check-ignore-message-loop:incomplete")).toBeNull();
  expect(byTestId("check-turn-off-message-loop:incomplete")).not.toBeNull();
  await act(() => byTestId("check-about-message-loop:incomplete").click());
  expect(byTestId("check-about-text-message-loop:incomplete").textContent).toContain("Messages loop back");
});

it("keeps All checks outside the findings list and returns its focus when findings unmount", async () => {
  const render = (shown: boolean) =>
    root.render(
      <div data-check-fallback-scope data-testid="inspector-body" tabIndex={-1}>
        {shown && <InspectorFindings findings={[finding("topic")]} host={host} state={state} />}
      </div>,
    );
  await act(() => render(true));
  const list = byTestId("inspector-findings");
  const button = byTestId("inspector-open-checks");
  expect(list.getAttribute("role")).toBe("list");
  expect([...list.children].map((child) => child.getAttribute("role"))).toEqual(["listitem"]);
  expect(list.contains(button)).toBe(false);
  expect(list.nextElementSibling).toBe(button);
  button.focus();
  expect(document.activeElement).toBe(button);
  await act(() => render(false));
  expect(document.activeElement).toBe(byTestId("inspector-body"));
});

it("keeps pagination outside both check lists while Show more adds finding rows", async () => {
  const findings = ["warning", "suggestion"].flatMap((severity) =>
    Array.from({ length: 41 }, (_, i) => finding(`${severity}-${i}`, severity as Finding["severity"])),
  );
  await act(() =>
    root.render(
      <ChecksCard
        {...host}
        result={{ findings, ignored: [], off: [], ran: ["no-reader"] }}
        state={state}
        returnFocus={vi.fn()}
        top={0}
        onClose={vi.fn()}
      />,
    ),
  );
  for (const severity of ["warnings", "suggestions"]) {
    const list = byTestId(`checks-group-${severity}`);
    expect([...list.children].map((child) => child.getAttribute("role"))).toEqual(Array(40).fill("listitem"));
    expect(list.nextElementSibling).toBe(byTestId(`checks-more-${severity}`));
  }
  await act(() => byTestId("checks-more-warnings").click());
  for (const severity of ["warnings", "suggestions"]) {
    expect(byTestId(`checks-group-${severity}`).children).toHaveLength(41);
    expect(byTestId(`checks-more-${severity}`)).toBeNull();
  }
});

it("numbers the complete list and opens only one finding, leaving closed rows as short sentences", async () => {
  const findings = [
    { ...finding("first"), message: "First sentence. More detail belongs in the open row." },
    { ...finding("second"), message: "Second sentence. Hidden explanation." },
    finding("hint", "suggestion"),
  ];
  await act(() =>
    root.render(
      <ChecksCard
        {...host}
        state={state}
        result={{ findings, ignored: [], off: [], ran: [] }}
        top={0}
        onClose={vi.fn()}
        returnFocus={vi.fn()}
      />,
    ),
  );
  expect(byTestId("check-number-first").textContent).toBe("1");
  expect(byTestId("check-number-hint").textContent).toBe("3");
  expect(byTestId("check-select-first").getAttribute("aria-expanded")).toBe("true");
  expect(byTestId("check-why-first")).not.toBeNull();
  expect(byTestId("check-why-second")).toBeNull();
  expect(byTestId("check-row-second").textContent).toContain("Second sentence.");
  expect(byTestId("check-row-second").textContent).not.toContain("Hidden explanation.");
  expect(byTestId("check-chips-second")).toBeNull();
  await act(() => byTestId("check-select-second").click());
  expect(byTestId("check-select-second").getAttribute("aria-expanded")).toBe("true");
  expect(byTestId("check-why-first")).toBeNull();
  expect(byTestId("check-why-second")).not.toBeNull();
  expect(byTestId("check-row-second").textContent).toContain("Hidden explanation.");
});
