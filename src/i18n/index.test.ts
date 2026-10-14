import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import en from "./en";
import { getLocale, msg, state, t, type Catalog } from "./index";
import { tRich } from "./rich";

// The runtime (./index.ts) as the build leaves it: these calls are rewritten by scripts/i18n-plugin.ts (Vitest runs
// the same plugin), plain messages to t`English` and the rest to t(number, English, values).

const id = (key: keyof typeof en) => Object.keys(en).sort().indexOf(key);

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

describe("t", () => {
  it("English, with no catalog loaded", () => {
    expect(t("file.new")).toBe("New diagram");
    expect(t("file.libraryCount", { count: 3 })).toBe("3 kept in this browser");
    expect(t("start.recentDetail", { count: 1, ago: "just now" })).toBe("1 node · edited just now");
    expect(t("start.recentDetail", { count: 12, ago: "5 min ago" })).toBe("12 nodes · edited 5 min ago");
  });

  it("the language's message: plain ones by their English, the rest by number", () => {
    state.l = "de";
    state.c = {
      "New diagram": "Neues Diagramm",
      [id("file.libraryCount")]: (v: Record<string, unknown>) => `${String(v.count)} in diesem Browser`,
    } satisfies Catalog;
    expect(t("file.new")).toBe("Neues Diagramm");
    expect(t("file.libraryCount", { count: 3 })).toBe("3 in diesem Browser");
    expect(getLocale()).toBe("de");
  });

  it("falls back to English for what the language hasn't translated", () => {
    state.c = { "New diagram": "Neues Diagramm" };
    expect(t("file.open")).toBe("Open…");
    expect(t("file.saveDestination", { name: "orders.diagram.json" })).toBe("To orders.diagram.json");
  });

  it("msg: a message for a table built once, in the language of the moment", () => {
    const undo = msg("shortcuts.undo");
    expect(undo()).toBe("Undo");
    state.c = { Undo: "Rückgängig" };
    expect(undo()).toBe("Rückgängig");
  });

  it("tRich: tags rendered by the caller, the words translated around them", () => {
    const b = (chunks: unknown) => createElement("strong", null, chunks as string);
    expect(renderToStaticMarkup(tRich("share.linkDesc", { b }))).toBe(
      "<strong>Public:</strong> anyone with the link can open it.",
    );
    state.c = {
      [id("share.linkDesc")]: (v: Record<string, unknown>) => [
        (v.b as (c: string) => unknown)("Öffentlich:"),
        " Jeder mit dem Link kann es öffnen.",
      ],
    };
    expect(renderToStaticMarkup(tRich("share.linkDesc", { b }))).toBe(
      "<strong>Öffentlich:</strong> Jeder mit dem Link kann es öffnen.",
    );
  });

  it("types: a message's arguments are required, and checked", () => {
    // @ts-expect-error: the count is missing.
    expect(() => t("file.libraryCount")).toThrow();
    // @ts-expect-error: a plural's count is a number.
    t("file.libraryCount", { count: "3" });
    // @ts-expect-error: a plain message takes no values.
    t("file.new", { count: 1 });
    t("ai.opsReady", { count: 1 });
    // @ts-expect-error: a count reused as a plain argument inside its plural is still numeric.
    t("ai.opsReady", { count: "1" });
  });

  it("types: no unknown keys, and a message with tags only through tRich", () => {
    // Types only: the build rejects these calls outright (scripts/i18n-plugin.ts), so they're never written as calls.
    type Key = Parameters<typeof t>[0];
    type MsgKey = Parameters<typeof msg>[0];
    // @ts-expect-error: no such key.
    const unknown: Key = "file.nope";
    // @ts-expect-error: share.public has <b>: t can't render it.
    const richT: Key = "share.public";
    // @ts-expect-error: start.about has <b>: nor can msg.
    const richMsg: MsgKey = "start.about";
    const plain: Key = "file.new";
    expect([unknown, richT, richMsg, plain]).toHaveLength(4);
  });
});
