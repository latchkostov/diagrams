import { DockTabs } from "./inspector/DockTabs";
import { workbenchDock, useWorkbenchDock } from "./inspector/dockState";
import { activateDock } from "./inspector/dockActions";
import { ChecksCardView } from "./checks/ChecksViews";
import { checksPanel, useChecksPanel } from "./checks/checksPanel";
import { aiDock } from "../ai/ui/dock";
import { useUnseen } from "../ai/ui/unseen";
import { paletteHost } from "../palette/host";
import { NodePanel } from "./inspector/NodePanel";
import { defineLazySurface } from "../lib/lazySurface";
import { useId, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { GROUP_PREFIX } from "./types";
import { Icon } from "../components/Icon";
import { t, useLocale } from "../i18n";
import { kindLabel } from "../i18n/chrome";
import { type LoadStatus } from "../lib/lazyLoad";

import { type InspectorProps } from "./inspector/types";
import { SheetResizeHandle } from "./SheetResizeHandle";
import { InteractionContext, useInteractionOrLocal } from "./interaction";

import { PanelUnavailable } from "./inspector/PanelUnavailable";
export { PanelUnavailable } from "./inspector/PanelUnavailable";

/**
 * Stands in for a panel while its code downloads: nothing (a rename asked of it meanwhile holds what's typed until
 * its field takes focus: the interaction controller's pending rename). If the download fails, a marker says whose
 * fields won't come (`owner`: the flow id its name field names), so the DOM port resolves them as gone, the request
 * ends and the keys go back to the canvas. The way back is the toast's Retry, which ships with the app, never with
 * the panel's chunk.
 */
function pending<P>(owner?: (props: P) => string) {
  return (props: P, status: LoadStatus): ReactNode =>
    status.failed ? <PanelUnavailable owner={owner?.(props)} /> : null;
}

const EdgePanel = defineLazySurface({
  id: "inspector.edge-shell",
  load: () => import("./inspector/lazyEdgePanel").then((m) => m.EdgePanel),
  placeholder: {
    render: pending((p: { edge: { id: string } }) => p.edge.id),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
const GroupPanel = defineLazySurface({
  id: "inspector.group",
  load: () => import("./inspector/GroupPanel").then((m) => m.GroupPanel),
  placeholder: {
    render: pending((p: { group: { id: string } }) => p.group.id),
  },
  focus: {},
  export: "skip",
  retryToast: true,
});
const AnnotationPanel = defineLazySurface({
  id: "inspector.annotation",
  load: () => import("./inspector/AnnotationPanel").then((m) => m.AnnotationPanel),
  placeholder: { render: pending() },
  focus: {},
  export: "skip",
  retryToast: true,
});
const DiagramPanel = defineLazySurface({
  id: "inspector.diagram",
  load: () => import("./inspector/DiagramPanel").then((m) => m.DiagramPanel),
  placeholder: { render: pending() },
  focus: {},
  export: "skip",
  retryToast: true,
});
const MultiPanel = defineLazySurface({
  id: "inspector.multi",
  load: () => import("./inspector/MultiPanel").then((m) => m.MultiPanel),
  placeholder: { render: pending() },
  focus: {},
  export: "skip",
  retryToast: true,
});

export function Inspector(p: InspectorProps) {
  // The Lab can render an inspector without a canvas's interaction provider.
  const { controller: interaction, local } = useInteractionOrLocal();
  const within = (sheet: ReactNode) =>
    local ? <InteractionContext.Provider value={interaction}>{sheet}</InteractionContext.Provider> : sheet;
  const locale = useLocale();
  const dock = useWorkbenchDock();
  const snap = dock.snap;
  const activeTab = dock.value === "closed" ? "properties" : dock.value;
  const id = useId();
  const warnings = useSyncExternalStore(
    p.checksStore?.subscribe ?? emptySubscribe,
    () => p.checksStore?.get().warnings ?? 0,
  );
  const checksAvailable = useChecksPanel().available;
  const documentId = useSyncExternalStore(paletteHost.subscribe, () => paletteHost.get().canvas?.documentId);
  const fresh = useUnseen(documentId);

  // A field asked for (F2 then a name; a double-click then a name) takes focus at once, so the next key typed
  // reaches it, and again a frame later only if something took focus back meanwhile (the menu that asked for it,
  // closing); not when the person moved it (Enter straight after, a third click). Each request once: one made
  // while folded waits for the inspector to open, one made before React Flow's selection arrives waits for the
  // field of the item it names, and folding and opening again later never repeats it (focus policy, row I1).
  const takeFocus = p.takeFocus;
  const editor = p.editor;
  const onNamed = p.onNamed;
  useLayoutEffect(() => {
    const f = p.focus;
    if (!f) return;
    interaction.dispatch({
      type: "inspector.field",
      seq: f.seq,
      name: f.name,
      owner: f.target,
      caret: f.caret,
      text: f.text,
      acceptName: f.target
        ? (typed) => {
            const owner = f.target;
            if (!owner) return;
            const group = owner.startsWith(GROUP_PREFIX);
            const id = group ? owner.slice(GROUP_PREFIX.length) : owner;
            const kind = group ? "group" : editor.getNode(id) ? "node" : "edge";
            const tag = editor.beginNaming(kind, id);
            flushSync(() => {
              if (typed.text !== null) {
                if (kind === "node")
                  editor.updateNode(id, { [f.name === "sublabel" ? "sublabel" : "label"]: typed.text }, { merge: tag });
                else if (kind === "group") editor.updateGroup(id, { label: typed.text }, { merge: tag });
                else editor.updateEdge(id, { label: typed.text }, { merge: tag });
              }
              editor.doneNaming(tag);
              onNamed?.();
              takeFocus?.(f.seq);
            });
          }
        : undefined,
      claim: takeFocus ? () => takeFocus(f.seq) : undefined,
    });
  }, [p.focus, editor, onNamed, takeFocus, interaction]);
  // Every commit of the sheet: a field waiting for its panel (or for the inspector to open) may be there now.
  useLayoutEffect(() => interaction.rendered());

  const annotations = p.selectedAnnotations ?? [];
  const n = p.selectedNodes.length + p.selectedGroups.length + p.selectedEdges.length + annotations.length;
  let title = t("inspector.diagram");
  let mode: string = "diagram";
  let content: ReactNode;
  if (n === 0) content = <DiagramPanel {...p} />;
  else if (n === 1 && p.selectedNodes[0]) {
    title = t("inspector.node");
    mode = "node";
    content = <NodePanel key={p.selectedNodes[0].id} node={p.selectedNodes[0]} {...p} />;
  } else if (n === 1 && p.selectedEdges[0]) {
    title = t("inspector.edge");
    mode = "edge";
    content = <EdgePanel key={p.selectedEdges[0].id} edge={p.selectedEdges[0]} {...p} />;
  } else if (n === 1 && annotations[0]) {
    title = kindLabel[annotations[0].data.kind];
    mode = annotations[0].data.kind;
    content = <AnnotationPanel key={annotations[0].id} note={annotations[0]} {...p} />;
  } else if (n === 1 && p.selectedGroups[0]) {
    title = t("inspector.boundary");
    mode = "boundary";
    content = <GroupPanel key={p.selectedGroups[0].id} group={p.selectedGroups[0]} {...p} />;
  } else {
    title = t("inspector.selectedCount", { count: n });
    mode = "selection";
    content = <MultiPanel {...p} />;
  }

  const head = useMemo(
    () => (
      <>
        <SheetResizeHandle onResize={p.onResize} />
        <div className="insp-head">
          <DockTabs
            active={activeTab}
            warnings={warnings}
            fresh={fresh}
            id={id}
            onSelect={activateDock}
            checksAvailable={checksAvailable}
            onEscape={() => {
              checksPanel.close();
              const next = workbenchDock.get().value;
              if (next === "closed") p.checksHost?.returnFocus();
              return next;
            }}
          />
          <span className="sr-only" id={id + "-title"} data-testid="inspector-title">
            {title}
          </span>
          <button
            className="icon-btn"
            onClick={p.onToggle}
            title={t("inspector.hideInspector")}
            aria-label={t("inspector.hideInspector")}
            data-testid="inspector-toggle"
          >
            <Icon name="panel-right" />
          </button>
        </div>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The active locale invalidates translated text.
    [p.onResize, p.onToggle, locale, title, activeTab, warnings, fresh, id, checksAvailable],
  );
  if (p.collapsed) {
    return within(
      <aside
        className="inspector is-collapsed"
        data-testid="inspector"
        data-collapsed="1"
        aria-label={t("inspector.inspector")}
      >
        <button
          className="icon-btn"
          onClick={p.onToggle}
          title={t("inspector.showInspector")}
          aria-label={t("inspector.showInspector")}
          data-testid="inspector-toggle"
        >
          <Icon name="panel-right" />
        </button>
      </aside>,
    );
  }

  return within(
    <aside
      className="inspector"
      data-sheet-snap={snap}
      data-testid="inspector"
      aria-label={t("inspector.inspector")}
      data-inspector-mode={mode}
      data-dock-tab={activeTab}
      data-inspector-target={
        n === 1 ? (p.selectedNodes[0] ?? p.selectedEdges[0] ?? p.selectedGroups[0] ?? annotations[0])?.id : undefined
      }
    >
      <div className="dock-snap-controls" data-testid="dock-snap-controls">
        {(["peek", "half", "full"] as const).map((value) => (
          <button
            key={value}
            data-testid={`dock-snap-${value}`}
            aria-pressed={snap === value}
            aria-label={
              value === "peek"
                ? t("workbench.sheetPeek")
                : value === "half"
                  ? t("workbench.sheetHalf")
                  : t("workbench.sheetFull")
            }
            onClick={() => workbenchDock.snap(value)}
          >
            <span aria-hidden>{value === "peek" ? "▁" : value === "half" ? "▄" : "█"}</span>
          </button>
        ))}
      </div>
      {head}
      {/* Where focus goes after a finding's fix when no other finding is left to take it. */}
      <div
        className="insp-body"
        data-testid="inspector-body"
        data-check-fallback-scope
        role="tabpanel"
        id={id + "-panel"}
        aria-labelledby={id + "-" + activeTab + " " + id + "-title"}
      >
        {activeTab === "properties" && (
          <>
            {n === 1 && !p.selectedNodes[0] && p.findings}
            {content}
          </>
        )}
        {activeTab === "checks" && p.checksStore && p.checksHost && (
          <ChecksCardView
            store={p.checksStore}
            host={p.checksHost}
            top={0}
            onMount={p.onResize ?? (() => {})}
            placement="dock"
          />
        )}
        <div className="dock-ai-content" data-testid="dock-ai-content" ref={mountAiPanel} hidden={activeTab !== "ai"} />
      </div>
    </aside>,
  );
}

export type { InspectorProps } from "./inspector/types";

const emptySubscribe = () => () => {};
const mountAiPanel = (element: HTMLDivElement | null) => aiDock.mount(element);
