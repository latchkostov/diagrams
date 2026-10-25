import { describe, expect, it, vi } from "vitest";
import { editMessageProps, messageRules, type MessageRule } from "./messageRules";
import { emitsMapping } from "./emitsMapping";
import { parseNative, serializeNative, validateDiagram } from "../interop/native";
import { nodeSimPropsSchema } from "./simProps";
import { checkJsonSchema } from "./jsonSchema";
import { messageTypesFixture } from "../lab/messageTypesFixture";
import { messageTypesAt } from "./messageTypes";
import { emittedType } from "../sim/topology";
import { resolveNodeProps } from "../sim/defaults";
import { fromFlow, toFlow } from "../canvas/convert";
import { decodeShare, encodeShare } from "../interop/share";
import { diagramToDrawio } from "../interop/drawio/write";
import { diagramToMermaid } from "../interop/mermaid/write";
import { buildPayload } from "../export/inject";
import { planningInput } from "../planning/workBudget";

const ids = (emits: unknown) => messageRules(emits).map((rule) => rule.id);

describe("message rule identity", () => {
  it.each(["Sent", { Send: "Sent" }, [{ receives: "Send", sends: "Sent", future: true }]])(
    "holds the authored form in memory and every output boundary writes it unchanged: %j",
    async (emits) => {
      const input = messageTypesFixture();
      input.nodes[1].props = { emits };
      const text = serializeNative(input);
      const flow = toFlow(input);
      const loaded = fromFlow(flow.meta, flow.nodes, flow.edges);
      expect(loaded.nodes[1].props?.emits).toEqual(emits);
      expect(ids(loaded.nodes[1].props?.emits)).toEqual(ids(emits));
      expect(serializeNative(loaded)).toBe(text);
      const parsed = parseNative(text);
      expect(parsed.ok && serializeNative(parsed.diagram)).toBe(text);
      expect(await decodeShare(await encodeShare(loaded))).toEqual(input);
      expect(diagramToDrawio(loaded)).toBe(diagramToDrawio(input));
      expect(diagramToMermaid(loaded)).toBe(diagramToMermaid(input));
      const html = (diagram: typeof input) =>
        buildPayload('<script type="application/json" id="ld-stencil-icons">{}</script>', {
          diagram,
          theme: "light",
          iconSvgs: {},
        }).diagram;
      expect(html(loaded)).toEqual(html(input));
      // Editing the rule is what makes its identity explicit.
      const previous = loaded.nodes[1].props!;
      const [rule] = messageRules(previous.emits);
      loaded.nodes[1].props = editMessageProps({ emits: [{ ...rule, sends: "Edited" }] }, previous);
      const { id: _id, ...content } = rule;
      expect(JSON.parse(serializeNative(loaded)).nodes[1].props.emits).toEqual([
        { id: rule.id, ...content, sends: "Edited" },
      ]);
    },
  );

  it("derives IDs from the incoming type, so copies, reloads and sibling removal keep every identity", () => {
    const emits = { A: "B", C: "D", E: "F" };
    const derived = ids(emits);
    expect(new Set(derived).size).toBe(3);
    expect(ids(structuredClone(emits))).toEqual(derived);
    expect(ids(JSON.parse(JSON.stringify(emits)))).toEqual(derived);
    expect(ids({ C: "D", E: "F" })).toEqual(derived.slice(1));
    expect(ids({ E: "F", A: "Changed", C: "D" })).toEqual([derived[2], derived[0], derived[1]]);
    // One computation per list reference: room projection and render re-reads reuse it.
    expect(messageRules(emits)).toBe(messageRules(emits));
  });

  it("materializes only edited and appended rules, preserving explicit IDs and untouched ID-less siblings", () => {
    const previous = {
      emits: [
        { receives: "A", sends: "B" },
        { id: "authored", receives: "C", sends: "D" },
        { receives: "E", sends: "F" },
      ],
    };
    const rows = messageRules(previous.emits);
    const edited = editMessageProps(
      { emits: [{ ...rows[0], receives: "Renamed" }, rows[1], rows[2], { receives: "New", sends: "Output" }] },
      previous,
    );
    expect(edited.emits).toEqual([
      { id: rows[0].id, receives: "Renamed", sends: "B" },
      { id: "authored", receives: "C", sends: "D" },
      { receives: "E", sends: "F" },
      { id: expect.stringMatching(/^rule-/), receives: "New", sends: "Output" },
    ]);
    const kept = edited.emits as MessageRule[];
    expect(kept[1]).toBe(previous.emits[1]);
    expect(kept[2]).toBe(previous.emits[2]);
    expect(ids(edited.emits).slice(0, 3)).toEqual(rows.map((rule) => rule.id));
  });

  it("returns the authored list itself when nothing changed, and keeps legacy maps when rules are only removed", () => {
    const previous = { emits: { A: "B", C: "D" } };
    const rows = messageRules(previous.emits);
    expect(editMessageProps({ emits: [...rows] }, previous).emits).toBe(previous.emits);
    expect(editMessageProps({ emits: { A: "B", C: "D" } }, previous).emits).toBe(previous.emits);
    const removed = editMessageProps({ emits: [rows[1]] }, previous);
    expect(removed.emits).toEqual({ C: "D" });
    expect(ids(removed.emits)).toEqual([rows[1].id]);
    expect(editMessageProps({ emits: "Sent" }, { emits: "Sent" }).emits).toBe("Sent");
    expect(editMessageProps({ emits: undefined }, previous)).toEqual({ emits: undefined });
  });

  it("keeps edits to unknown rule fields when materializing an identity", () => {
    const previous = { emits: [{ receives: "A", sends: "B", future: "before" }] };
    const [rule] = messageRules(previous.emits);
    expect(editMessageProps({ emits: [{ ...rule, future: "after" }] }, previous).emits).toEqual([
      { id: rule.id, receives: "A", sends: "B", future: "after" },
    ]);
  });

  it("creates fresh IDs when only insecure-context crypto is available", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const first = ids(editMessageProps({ emits: { A: "B" } }, {}).emits);
      const second = ids(editMessageProps({ emits: { A: "B" } }, {}).emits);
      expect(first[0]).toMatch(/^rule-[0-9a-z]+$/);
      expect(first[0]).not.toBe(second[0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([false, true])("reserves explicit IDs before inheritance (explicit first: %s)", (explicitFirst) => {
    const previous = { emits: [{ id: "r", receives: "A", sends: "X" }] };
    const explicit = { id: "r", receives: "B", sends: "Y" };
    const implicit = { receives: "A", sends: "X" };
    const result = editMessageProps({ emits: explicitFirst ? [explicit, implicit] : [implicit, explicit] }, previous);
    const rules = messageRules(result.emits);
    expect(result.emits).toEqual(rules);
    expect(rules.find((rule) => rule.receives === "B")).toEqual(explicit);
    expect(rules.find((rule) => rule.receives === "A")!.id).not.toBe("r");
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(2);
  });

  it("gives new rules fresh IDs while surviving rules keep theirs and explicit renames stay verbatim", () => {
    const previous = { emits: { A: "B" } };
    const edit = editMessageProps({ emits: { A: "C", D: "E" } }, previous);
    const again = editMessageProps({ emits: { A: "C", D: "E" } }, previous);
    const rules = messageRules(edit.emits);
    expect(rules[0].id).toBe(ids(previous.emits)[0]);
    expect(rules[1].id).not.toBe(ids(again.emits)[1]);
    const renamed = [rules[0], { ...rules[1], receives: "Renamed" }];
    expect(editMessageProps({ emits: renamed }, edit).emits).toEqual(renamed);
  });

  it("round-trips duplicate and mixed explicit IDs verbatim while runtime IDs stay unique", () => {
    const diagram = messageTypesFixture();
    const emits = [
      { receives: "A", sends: "B" },
      { id: "x", receives: "B", sends: "C", future: true },
      { id: "x", receives: "C", sends: "D" },
      { id: "authored/identity", receives: "D", sends: "E" },
    ];
    diagram.nodes[1].props = { emits };
    const text = serializeNative(diagram);
    const parsed = parseNative(text);
    expect(parsed.ok && serializeNative(parsed.diagram)).toBe(text);
    const runtime = ids(emits);
    expect(runtime[1]).toBe("x");
    expect(runtime[3]).toBe("authored/identity");
    expect(new Set(runtime).size).toBe(4);
    // Editing another rule keeps the duplicate exactly as authored.
    const rows = messageRules(emits);
    const edited = editMessageProps({ emits: [{ ...rows[0], sends: "Z" }, ...rows.slice(1)] }, { emits });
    expect((edited.emits as MessageRule[]).slice(1)).toEqual(emits.slice(1));
  });

  it("treats file-supplied runtime-looking metadata as an ordinary unknown field", () => {
    const diagram = messageTypesFixture();
    const emits = [{ id: "r", receives: "A", sends: "B", __derivedMessageRule: { id: "r" } }];
    diagram.nodes[1].props = { emits };
    const text = serializeNative(diagram);
    const parsed = parseNative(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && serializeNative(parsed.diagram)).toBe(text);
    expect(ids(emits)).toEqual(["r"]);
    expect(validateDiagram({ ...diagram, nodes: [{ ...diagram.nodes[1], props: { emits: [{ id: 4 }] } }] }).ok).toBe(
      false,
    );
  });

  it("keeps the engine's sanitized rule lookup independent of authored props", () => {
    const diagram = messageTypesFixture();
    const emits = { Send: "Original", invalid: 7 };
    diagram.nodes[1].props = { emits };
    const resolved = resolveNodeProps(diagram, diagram.nodes[1]);
    expect(resolved.emits).toEqual({ Send: "Original" });
    emits.Send = "Changed";
    expect(emittedType(resolved.emits, "Send")).toBe("Original");
  });

  it.each(["Sent", { Send: "Sent", "*": "Other" }])("rule arrays behave exactly like the legacy form: %j", (legacy) => {
    const diagram = messageTypesFixture();
    diagram.nodes[1].props = { emits: legacy };
    const rules = messageRules(legacy).map((rule, i) => ({ ...rule, id: `explicit-${i}` }));
    const withIds = messageTypesFixture();
    withIds.nodes[1].props = { emits: rules };
    expect(messageTypesAt(withIds)).toEqual(messageTypesAt(diagram));
    for (const type of ["Send", "Callback", "Unknown", "constructor", "__proto__"]) {
      expect(emittedType(emitsMapping(rules), type)).toBe(emittedType(legacy, type));
      expect(emittedType(resolveNodeProps(withIds, withIds.nodes[1]).emits, type)).toBe(emittedType(legacy, type));
    }
    const map = messageTypesFixture();
    map.nodes[1].props = { emits: emitsMapping(rules) };
    expect(planningInput(withIds)).toEqual(planningInput(map));
  });

  it("budgets planning on the behavioral mapping, excluding identity metadata", () => {
    const legacy = messageTypesFixture();
    // 1,100 mappings fit the 4,096-item ceiling; with their IDs counted, the same rules would not.
    const mapping = Object.fromEntries(Array.from({ length: 1_100 }, (_, i) => [`T${i}`, "Out"]));
    legacy.nodes[1].props = { emits: mapping };
    expect(planningInput(legacy)).toBeDefined();
    const identified = messageTypesFixture();
    identified.nodes[1].props = {
      emits: messageRules(mapping).map((rule) => ({ ...rule, id: `rule-${rule.receives}-identity` })),
    };
    expect(planningInput(identified)).toEqual(planningInput(legacy));
  });

  it("publishes optional IDs and validates the new rule grammar", () => {
    expect(() => checkJsonSchema({ emits: [{ receives: "A", sends: "B" }] }, nodeSimPropsSchema)).not.toThrow();
    expect(() =>
      checkJsonSchema({ emits: [{ id: "stable", receives: "A", sends: "B", future: 1 }] }, nodeSimPropsSchema),
    ).not.toThrow();
    for (const rule of [{ id: 1, receives: "A", sends: "B" }, { id: "", receives: "A", sends: "B" }, { receives: "A" }])
      expect(() => checkJsonSchema({ emits: [rule] }, nodeSimPropsSchema)).toThrow();
  });

  it("maps rule arrays once per list for the engine and type analysis", () => {
    const rules = [
      { id: "a", receives: "A", sends: "B" },
      { receives: "A", sends: "C" },
    ];
    expect(emitsMapping(rules)).toEqual({ A: "C" });
    expect(emitsMapping(rules)).toBe(emitsMapping(rules));
    expect(emitsMapping("X")).toBe("X");
  });
});
