import { ChecksStore } from "./useChecks";
import { expect, it, vi } from "vitest";
import { FindingSelection } from "./findingSelection";
import { findingOrder, findingTag, selectedFinding, firstSentence } from "../../checks/ui/findingOrder";
import type { Finding } from "../../checks/types";

const finding = (id: string, elements: string[], severity: Finding["severity"] = "warning"): Finding => ({
  id,
  elements,
  severity,
  target: elements[0],
  rule: "no-reader",
  title: id,
  message: id,
  rationale: id,
});
it("closes sentences with punctuation used by the shipped locales", () => {
  expect(firstSentence("No reader. Add one.")).toBe("No reader. ");
  expect(firstSentence("没有消费者。添加一个。")).toBe("没有消费者。");
  expect(firstSentence("कोई उपभोक्ता नहीं है। एक जोड़ें।")).toBe("कोई उपभोक्ता नहीं है।");
});
it("shares selection and filtering without turning hover into selection", () => {
  const selection = new FindingSelection();
  const changed = vi.fn();
  const off = selection.subscribe(changed);
  selection.select("first");
  selection.select("first");
  expect(changed).toHaveBeenCalledTimes(1);
  selection.filter("checkout");
  expect(selection.get()).toEqual({ finding: null, element: "checkout" });
  selection.reset();
  expect(selection.get()).toEqual({ finding: null, element: null });
  off();
});
it("keeps full-list numbers through filtering and folds unselected findings into a count", () => {
  const first = finding("unread", ["orders", "checkout"]);
  const others = [
    finding("backoff", ["payments", "checkout"]),
    finding("post", ["payments", "checkout"]),
    finding("storm", ["payments", "checkout"]),
  ];
  const ordered = findingOrder([finding("hint", ["payments"], "suggestion"), first, ...others]);
  const numbers = new Map(ordered.map((f, i) => [f.id, i + 1]));
  expect(findingTag([first, ...others], first.id, numbers)).toEqual({
    selected: { id: "unread", number: 1, title: "unread" },
    count: 3,
  });
  expect(findingTag(others, first.id, numbers)).toEqual({ selected: undefined, count: 3 });
  expect(selectedFinding(ordered, null, "payments")?.id).toBe("backoff");
  expect(numbers.get(selectedFinding(ordered, "post", "payments")!.id)).toBe(3);
});

it("clears an element filter when a fix removes its last finding", () => {
  const store = new ChecksStore();
  store.set({ findings: [finding("first", ["checkout"])], ignored: [], off: [], ran: [] });
  store.selection.filter("checkout");
  store.set({ findings: [], ignored: [], off: [], ran: [] });
  expect(store.selection.get()).toEqual({ finding: null, element: null });
});
