import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "../../i18n";
import { useTraceActions } from "./useTraceSpotlight";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
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

it("Free play explains missing traffic sources in the existing hint slot", () => {
  function Notice({
    source = false,
    traffic = true,
    simulation = null,
    resourceError,
    notice,
  }: {
    source?: boolean;
    traffic?: boolean;
    simulation?: object | null;
    resourceError?: string;
    notice?: string;
  }) {
    const actions = useTraceActions({
      session: {
        controller: {},
        state: {
          simulation,
          traffic,
          resourceError,
          snapshot: { nodes: { api: { role: source ? "source" : "processor" } } },
        },
        panel: { open: true },
        notice,
      },
      spotlight: { slowRef: { current: null } },
      presenting: false,
    } as unknown as Parameters<typeof useTraceActions>[0]);
    return <p>{actions.shownNotice}</p>;
  }
  const render = (props: Parameters<typeof Notice>[0] = {}) =>
    renderToStaticMarkup(
      <ReactFlowProvider>
        <Notice {...props} />
      </ReactFlowProvider>,
    );
  expect(render()).toContain("Nothing is sending traffic yet. Click a node to send a request, or add a source.");
  expect(render({ source: true })).toBe("<p></p>");
  expect(render({ traffic: false })).toBe("<p></p>");
  expect(render({ simulation: {} })).toBe("<p></p>");
  expect(render({ resourceError: "Budget reached" })).toBe("<p>Budget reached</p>");
  expect(render({ notice: "Saved" })).toBe("<p>Saved</p>");
});
