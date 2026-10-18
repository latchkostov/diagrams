import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../../i18n";
import { useSlowTraceCard, useTraceActions } from "./useTraceSpotlight";
import { PACING } from "../slowmo/script";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

it("slow-motion notes translate the duration and whole sentences without changing English", async () => {
  const slow = {
    state: {
      status: "on",
      script: { unfinished: true, summary: "Still moving", duration: PACING.longScript + 1 },
      trace: { rootId: 1 },
    },
    session: {},
  } as unknown as Parameters<typeof useSlowTraceCard>[0];
  function Notes() {
    return <p>{useSlowTraceCard(slow)?.card.note}</p>;
  }
  const english = renderToStaticMarkup(<Notes />);
  expect(english).toContain("Recorded for 30 s of simulated time: still moving.");
  expect(english).toContain("skips to the next hop.");
  state.l = "en-XA";
  state.c = (await catalogs["en-XA"]()).default as Catalog;
  const translated = renderToStaticMarkup(<Notes />);
  expect(translated).not.toContain("Recorded for 30 s of simulated time");
  expect(translated).not.toContain("skips to the next hop.");
});

it("a dead-letter wait translates at display time and clears after a language switch when a trace arrives", async () => {
  function Notice({ finished = false }: { finished?: boolean }) {
    const actions = useTraceActions({
      session: {
        controller: {},
        state: { trace: { current: finished ? {} : undefined } },
        panel: { open: true },
        notice: "trace:deadLetterWait",
      },
      spotlight: { slowRef: { current: null } },
      presenting: false,
    } as unknown as Parameters<typeof useTraceActions>[0]);
    return <p>{actions.shownNotice}</p>;
  }
  const render = (finished = false) =>
    renderToStaticMarkup(
      <ReactFlowProvider>
        <Notice finished={finished} />
      </ReactFlowProvider>,
    );
  expect(render()).toContain("Nothing has dead-lettered yet");
  state.l = "en-XA";
  state.c = (await catalogs["en-XA"]()).default as Catalog;
  expect(render()).not.toContain("Nothing has dead-lettered yet");
  expect(render()).not.toContain("trace:deadLetterWait");
  expect(render(true)).toBe("<p></p>");
});
