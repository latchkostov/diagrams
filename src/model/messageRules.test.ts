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
import { LiveController } from "../live/controller";
import { opGrowth, ops } from "../test/opCounter";
import { countingReads, GROWTH_FACTOR, LINEAR_LIMIT } from "../test/complexity";

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

  it.each([0, 1, 2])("preserves surviving runtime IDs when duplicate-ID sibling %s is removed", (removed) => {
    const previous = {
      emits: [
        { id: "duplicate", receives: "A", sends: "B" },
        { id: "duplicate", receives: "C", sends: "D" },
        { id: "duplicate", receives: "E", sends: "F" },
      ],
    };
    const survivors = messageRules(previous.emits).filter((_, i) => i !== removed);
    const edited = editMessageProps({ emits: survivors }, previous);
    expect(messageRules(edited.emits)).toEqual(survivors);
    expect(ids(JSON.parse(JSON.stringify(edited.emits)))).toEqual(survivors.map((rule) => rule.id));
    // The edit boundary only materializes a surviving row if its authored ID would now resolve differently.
    if (removed !== 0) expect((edited.emits as MessageRule[])[0]).toBe(previous.emits[0]);
  });

  it("preserves collision suffix identities when an ID-less sibling is removed", () => {
    const previous = {
      emits: [
        { receives: "A", sends: "B" },
        { receives: "A", sends: "C" },
        { receives: "X", sends: "Y" },
      ],
    };
    const survivor = messageRules(previous.emits)[1];
    const unrelated = messageRules(previous.emits)[2];
    const edited = editMessageProps({ emits: [survivor, unrelated] }, previous);
    expect(messageRules(edited.emits)).toEqual([survivor, unrelated]);
    expect((edited.emits as MessageRule[])[1]).toBe(previous.emits[2]);
  });

  it("preserves fallback identities after materializing a reordered duplicate-ID row (R-e4bfd3e926)", () => {
    const previous = {
      emits: [
        { id: "x", receives: "Z", sends: "Z" },
        { receives: "A", sends: "drop" },
        { receives: "A", sends: "keep" },
        { id: "x", receives: "A", sends: "move" },
      ],
    };
    const rows = messageRules(previous.emits);
    const survivors = [rows[0], rows[3], rows[2]];
    const edited = editMessageProps({ emits: survivors }, previous);
    expect(messageRules(edited.emits)).toEqual(survivors);
    expect(messageRules(JSON.parse(JSON.stringify(edited.emits)))).toEqual(survivors);
    expect((edited.emits as MessageRule[])[0]).toBe(previous.emits[0]);
    expect(editMessageProps({ emits: [...survivors] }, edited).emits).toBe(edited.emits);
  });

  it("repairs identities through newly materialized bases (R-12b86d777e)", () => {
    const b = ids([{ receives: "B", sends: "B" }])[0];
    const previous = {
      emits: [
        { id: "y", receives: "A", sends: "owner" },
        { id: b, receives: "B", sends: "remove" },
        { id: b, receives: "C", sends: "materialize" },
        { id: "y", receives: "B", sends: "keep" },
      ],
    };
    const rows = messageRules(previous.emits);
    const survivors = [rows[0], rows[3], rows[2]];
    const edited = editMessageProps({ emits: survivors }, previous);
    expect(messageRules(edited.emits)).toEqual(survivors);
    expect(messageRules(JSON.parse(JSON.stringify(edited.emits)))).toEqual(survivors);
    expect((edited.emits as MessageRule[])[0]).toBe(previous.emits[0]);
    expect(editMessageProps({ emits: [...survivors] }, edited).emits).toBe(edited.emits);
  });

  it("repairs many connected collision groups with linear work", () => {
    const edit = (n: number) => {
      const emits = Array.from({ length: n }, (_, i) => {
        const receives = `B${i}`;
        const b = ids([{ receives, sends: "B" }])[0];
        return [
          { id: `owner-${i}`, receives: `A${i}`, sends: "owner" },
          { id: b, receives, sends: "remove" },
          { id: b, receives: `C${i}`, sends: "materialize" },
          { id: `owner-${i}`, receives, sends: "keep" },
        ];
      }).flat();
      const rows = messageRules(emits);
      const survivors = rows.flatMap((_, i) => (i % 4 === 0 ? [rows[i], rows[i + 3], rows[i + 2]] : []));
      return () => {
        const edited = editMessageProps({ emits: survivors }, { emits });
        expect(messageRules(edited.emits)).toEqual(survivors);
      };
    };
    expect(opGrowth(edit(64), edit(64 * GROWTH_FACTOR), LINEAR_LIMIT)).toBeLessThanOrEqual(LINEAR_LIMIT);
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

  it.each(["Sent", { Send: "Sent", "*": "Other" }])(
    "rule arrays preserve simulation playback and seek: %j",
    (legacy) => {
      const diagram = messageTypesFixture();
      diagram.nodes[1].props = { emits: legacy };
      const withIds = messageTypesFixture();
      withIds.nodes[1].props = {
        emits: messageRules(legacy).map((rule, i) => ({ ...rule, id: `explicit-${i}` })),
      };
      const playback = (input: typeof diagram) => {
        const controller = new LiveController(input, { seed: 7, maxParticles: 0 });
        try {
          controller.selectSimulation({
            id: "rules",
            title: "Rules",
            durationMs: 3000,
            traffic: [
              {
                id: "send",
                node: "client",
                messageType: "Send",
                shape: { kind: "constant", ratePerSec: 4, durationMs: 2000 },
              },
            ],
          });
          const snapshots = [];
          for (let i = 0; i < 6; i++) {
            controller.step(500);
            snapshots.push(controller.snapshot());
          }
          expect(snapshots.at(-1)!.nodes.api.processed).toBeGreaterThan(0);
          expect(snapshots.at(-1)!.nodes.sender.processed).toBeGreaterThan(0);
          controller.seek(1000);
          expect(controller.snapshot()).toEqual(snapshots[1]);
          return snapshots;
        } finally {
          controller.dispose();
        }
      };
      expect(playback(withIds)).toEqual(playback(diagram));
    },
  );

  it.each(["diagram", "setup", "inputs", "configuration"] as const)(
    "bounds authored rule arrays before materializing %s behavioral mappings",
    (location) => {
      const controller = new LiveController(messageTypesFixture());
      try {
        for (const emits of [
          Array.from({ length: 10_000 }, () => ({ receives: "A", sends: "B" })),
          Array.from({ length: 1_000 }, () => ({ receives: "A", sends: "B".repeat(1000) })),
        ]) {
          const diagram = messageTypesFixture();
          const counted = countingReads(emits);
          const props = { api: { emits: counted.items } };
          const state = controller.getState();
          const configured =
            location === "diagram"
              ? state
              : location === "setup"
                ? { ...state, running: { id: "run", title: "Run", traffic: [], setup: { props } } }
                : location === "inputs"
                  ? { ...state, inputs: { ...state.inputs, props } }
                  : { ...state, configuration: props };
          if (location === "diagram") diagram.nodes[1].props = props.api;
          expect(planningInput(diagram, configured)).toBeUndefined();
          // Count mapping work directly: rejecting an oversized list must never build its full lookup table.
          expect(counted.reads()).toBeLessThan(emits.length / 8);
        }
      } finally {
        controller.dispose();
      }
    },
  );

  it("allocates collision suffixes in linear time for repeated ID-less incoming types (R-a7f416f1a9)", () => {
    const base = ids([{ receives: "A", sends: "B" }])[0];
    // Identical incoming types, plus explicit IDs squatting on the suffixes the derived ones would take.
    const repeated = (n: number) => () =>
      messageRules([
        ...Array.from({ length: n }, (_, i) => ({ id: `${base}-${2 * i + 2}`, receives: "Z", sends: "Y" })),
        ...Array.from({ length: n }, () => ({ receives: "A", sends: "B" })),
      ]);
    const size = 1_000;
    const growth = opGrowth(repeated(size), repeated(size * GROWTH_FACTOR), LINEAR_LIMIT);
    expect(growth).toBeLessThanOrEqual(LINEAR_LIMIT);
    expect(ops(repeated(size * GROWTH_FACTOR))).toBeLessThan(40 * size * GROWTH_FACTOR);
    const runtime = messageRules([
      { id: `${base}-2`, receives: "Z", sends: "Y" },
      ...Array.from({ length: 3 }, () => ({ receives: "A", sends: "B" })),
    ]).map((rule) => rule.id);
    expect(runtime).toEqual([`${base}-2`, base, `${base}-3`, `${base}-4`]);
    // Editing such a list stays linear too.
    const edit = (n: number) => {
      const emits = Array.from({ length: n }, () => ({ receives: "A", sends: "B" }));
      const rows = messageRules(emits);
      return () => editMessageProps({ emits: [...rows, { receives: "A", sends: "C" }] }, { emits });
    };
    expect(opGrowth(edit(size), edit(size * GROWTH_FACTOR), LINEAR_LIMIT)).toBeLessThanOrEqual(LINEAR_LIMIT);
  });

  it("budgets live configuration and saved setup on the behavioral mapping too (R-850af6b396)", () => {
    const mapping = Object.fromEntries(Array.from({ length: 1_100 }, (_, i) => [`T${i}`, "Out"]));
    const legacy = messageTypesFixture();
    legacy.nodes[1].props = { emits: mapping };
    const edited = messageTypesFixture();
    const rows = messageRules(mapping);
    edited.nodes[1].props = editMessageProps(
      { emits: [{ ...rows[0], sends: "Other" }, ...rows.slice(1)] },
      { emits: mapping },
    );
    expect(Array.isArray(edited.nodes[1].props.emits)).toBe(true);
    for (const diagram of [legacy, edited]) {
      const controller = new LiveController(diagram);
      try {
        const state = controller.getState();
        expect(Object.keys(state.configuration)).toContain("api");
        expect(planningInput(diagram, state)).toBeDefined();
        const setup = { props: { api: { emits: edited.nodes[1].props.emits } } };
        const running = { id: "s", title: "Run", traffic: [], setup };
        expect(planningInput(diagram, { ...state, running })).toBeDefined();
      } finally {
        controller.dispose();
      }
    }
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
