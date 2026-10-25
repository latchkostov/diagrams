// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChecksCard, InspectorFindings } from "./ChecksCard";
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
