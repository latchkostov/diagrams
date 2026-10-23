import { useLayoutEffect, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { t, useLocale } from "../i18n";
import { kindLabel } from "../i18n/chrome";
import { lazyComponent, type LoadStatus } from "../lib/lazyLoad";
import { NodePanel } from "./inspector/NodePanel";

import { type InspectorProps } from "./inspector/types";
import { SheetResizeHandle } from "./SheetResizeHandle";
import { InteractionContext, useInteractionOrLocal, type InteractionController } from "./interaction";

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

const EdgePanel = lazyComponent(
  () => import("./inspector/lazyEdgePanel").then((m) => m.EdgePanel),
  pending((p: { edge: { id: string } }) => p.edge.id),
  true,
);
const GroupPanel = lazyComponent(
  () => import("./inspector/GroupPanel").then((m) => m.GroupPanel),
  pending((p: { group: { id: string } }) => p.group.id),
  true,
);
const AnnotationPanel = lazyComponent(
  () => import("./inspector/AnnotationPanel").then((m) => m.AnnotationPanel),
  pending(),
  true,
);
const DiagramPanel = lazyComponent(
  () => import("./inspector/DiagramPanel").then((m) => m.DiagramPanel),
  pending(),
  true,
);
const MultiPanel = lazyComponent(() => import("./inspector/MultiPanel").then((m) => m.MultiPanel), pending(), true);

export function Inspector(p: InspectorProps) {
  // The canvas's focus controller moves focus into the fields; outside a canvas (the Lab), one of its own.
  const { controller, local } = useInteractionOrLocal();
  const sheet = <InspectorSheet {...p} interaction={controller} />;
  return local ? <InteractionContext.Provider value={controller}>{sheet}</InteractionContext.Provider> : sheet;
}

function InspectorSheet({ interaction, ...p }: InspectorProps & { interaction: InteractionController }) {
  useLocale();

  // A field asked for (F2 then a name; a double-click then a name) takes focus at once, so the next key typed
  // reaches it, and again a frame later only if something took focus back meanwhile (the menu that asked for it,
  // closing); not when the person moved it (Enter straight after, a third click). Each request once: one made
  // while folded waits for the inspector to open, one made before React Flow's selection arrives waits for the
  // field of the item it names, and folding and opening again later never repeats it (focus policy, row I1).
  const takeFocus = p.takeFocus;
  useLayoutEffect(() => {
    const f = p.focus;
    if (!f) return;
    interaction.dispatch({
      type: "inspector.field",
      seq: f.seq,
      name: f.name,
      owner: f.target,
      caret: f.caret,
      claim: takeFocus ? () => takeFocus(f.seq) : undefined,
    });
  }, [p.focus, takeFocus, interaction]);
  // Every commit of the sheet: a field waiting for its panel (or for the inspector to open) may be there now.
  useLayoutEffect(() => interaction.rendered());

  if (p.collapsed) {
    return (
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
      </aside>
    );
  }

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

  return (
    <aside
      className="inspector"
      data-testid="inspector"
      aria-label={t("inspector.inspector")}
      data-inspector-mode={mode}
      data-inspector-target={
        n === 1 ? (p.selectedNodes[0] ?? p.selectedEdges[0] ?? p.selectedGroups[0] ?? annotations[0])?.id : undefined
      }
    >
      <SheetResizeHandle onResize={p.onResize} />
      <div className="insp-head">
        <span className="insp-title" data-testid="inspector-title">
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
      {/* Where focus goes after a finding's fix when no other finding is left to take it. */}
      <div className="insp-body" data-testid="inspector-body" data-check-fallback-scope>
        {n === 1 && !p.selectedNodes[0] && p.findings}
        {content}
      </div>
    </aside>
  );
}

export type { InspectorProps } from "./inspector/types";
