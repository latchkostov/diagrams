// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChecksCard, InspectorFindings, TargetFindings } from "./ChecksCard";
import { registerRequestChecks } from "../../lib/requestCheckCache";
import { waitingFixture } from "../../lab/waitingFixture";
import { FindingRow } from "./FindingRow";
import type { RowHost } from "./FindingRow";
import type { Finding } from "../types";
import * as navigation from "../../canvas/keyboardNav";
import * as context from "../context";

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
  registerRequestChecks(undefined);
  vi.restoreAllMocks();
});

it("recovers omitted findings through StrictMode's cancellation replay", async () => {
  const diagram = waitingFixture();
  const recovered = { ...finding("timeout"), rule: "call-timeout" as const, target: "call", elements: ["call"] };
  registerRequestChecks(async (_d, options) => {
    options?.signal?.throwIfAborted();
    return [recovered];
  });
  await act(async () =>
    root.render(
      <StrictMode>
        <TargetFindings
          findings={[]}
          host={host}
          state={state}
          target={{
            id: "call",
            diagram,
            result: {
              findings: [],
              ignored: [],
              off: [],
              ran: ["call-timeout"],
              omitted: [{ rule: "call-timeout", count: 1 }],
            },
          }}
        />
      </StrictMode>,
    ),
  );
  expect(byTestId("inspector-check-row-timeout")).not.toBeNull();
  expect(byTestId("inspector-target-checks-retry")).toBeNull();
});

it("reuses a light reading-order index across recovered selections", async () => {
  const diagram = waitingFixture();
  const order = vi.spyOn(navigation, "readingOrder");
  const analysis = vi.spyOn(context, "buildContext");
  registerRequestChecks(async (_d, options) => [
    { ...finding(`timeout-${options?.target}`), rule: "call-timeout", elements: [options!.target!] },
  ]);
  const render = (id: string) =>
    root.render(
      <TargetFindings
        findings={[]}
        host={host}
        state={state}
        target={{
          id,
          diagram,
          result: {
            findings: [],
            ignored: [],
            off: [],
            ran: ["call-timeout"],
            omitted: [{ rule: "call-timeout", count: 1 }],
          },
        }}
      />,
    );
  for (const id of ["call", "input", "output"]) {
    await act(async () => render(id));
    expect(byTestId(`inspector-check-row-timeout-${id}`)).not.toBeNull();
  }
  expect(analysis).not.toHaveBeenCalled();
  expect(order).toHaveBeenCalledTimes(1);
});

it.each(["omitted", "unchecked"] as const)(
  "keeps All checks reachable for marker-only target results (%s)",
  async (marker) => {
    const diagram = waitingFixture();
    registerRequestChecks(async () => [{ ...finding("marker"), rule: "call-timeout", [marker]: 1 }]);
    await act(async () =>
      root.render(
        <TargetFindings
          findings={[]}
          host={host}
          state={state}
          target={{
            id: "call",
            diagram,
            result: {
              findings: [],
              ignored: [],
              off: [],
              ran: ["call-timeout"],
              omitted: [{ rule: "call-timeout", count: 1 }],
            },
          }}
        />,
      ),
    );
    expect(byTestId("inspector-target-checks-incomplete")).not.toBeNull();
    expect(byTestId("inspector-open-checks")).not.toBeNull();
    host.open.mockClear();
    await act(() => byTestId("inspector-open-checks").click());
    expect(host.open).toHaveBeenCalledTimes(1);
  },
);

it.each([4, 5, 6])("focuses the first new finding after More reveals the final page (%s findings)", async (size) => {
  const findings = Array.from({ length: size }, (_, i) => finding(`finding-${i}`));
  await act(() =>
    root.render(<TargetFindings findings={findings} host={host} state={state} target={{ id: "call", result: null }} />),
  );
  const more = byTestId("inspector-target-checks-more");
  more.focus();
  expect(document.activeElement).toBe(more);
  await act(() => more.click());
  expect(byTestId("inspector-target-checks-more")).toBeNull();
  expect(document.activeElement).toBe(byTestId("inspector-check-select-finding-3"));
});

it("keeps recovered target warnings first, partial analysis visible and Properties compact", async () => {
  const diagram = waitingFixture();
  const recovered = Array.from({ length: 6 }, (_, i) => ({
    ...finding(`retry-${i}`),
    rule: "retry-backoff" as const,
    target: "call",
    elements: ["call"],
  }));
  registerRequestChecks(async () => [...recovered, { ...finding("omitted"), rule: "call-timeout", omitted: 1 }]);
  const listed = [{ ...finding("timeout", "suggestion"), rule: "call-timeout" as const }];
  const result = {
    findings: listed,
    ignored: [],
    off: [],
    ran: ["retry-backoff", "call-timeout"] as const,
    omitted: [{ rule: "call-timeout" as const, count: 1 }],
  };
  await act(async () =>
    root.render(
      <TargetFindings
        findings={listed}
        host={host}
        state={state}
        target={{ id: "call", diagram, result: { ...result, ran: [...result.ran] } }}
      />,
    ),
  );
  expect(byTestId("inspector-target-checks-incomplete")?.textContent).toContain("Some findings are not listed");
  const rows = [...byTestId("inspector-findings").children];
  expect(rows).toHaveLength(3);
  expect(rows[0].getAttribute("data-testid")).toBe("inspector-check-row-retry-0");
  expect(byTestId("inspector-check-row-timeout")).toBeNull();
  await act(() => byTestId("inspector-target-checks-more").click());
  expect(byTestId("inspector-findings").children).toHaveLength(6);
  await act(() => byTestId("inspector-target-checks-more").click());
  expect(byTestId("inspector-check-row-timeout")).not.toBeNull();
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

it("keeps diagram diagnostics and guidance reachable without element actions", async () => {
  const diagnostic: Finding = {
    ...finding("diagram:message-loop:incomplete"),
    rule: "message-loop",
    scope: "diagram",
    target: "",
    elements: [],
    title: "Message type propagation incomplete",
    message: "Timeline forwarding edits cannot be analyzed completely.",
    rationale: "Review message paths before and after timeline forwarding edits manually.",
  };
  await act(() => root.render(<FindingRow finding={diagnostic} host={host} state={state} />));
  expect(byTestId("check-row-diagram:message-loop:incomplete").textContent).toContain(diagnostic.message);
  expect(byTestId("check-select-diagram:message-loop:incomplete")).toBeNull();
  expect(byTestId("check-why-diagram:message-loop:incomplete").textContent).toContain(diagnostic.rationale);
  await act(() => byTestId("check-more-diagram:message-loop:incomplete").click());
  expect(byTestId("check-ignore-diagram:message-loop:incomplete")).toBeNull();
  expect(byTestId("check-turn-off-diagram:message-loop:incomplete")).not.toBeNull();
  await act(() => byTestId("check-about-diagram:message-loop:incomplete").click());
  expect(byTestId("check-about-text-diagram:message-loop:incomplete").textContent).toContain("Messages loop back");
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
