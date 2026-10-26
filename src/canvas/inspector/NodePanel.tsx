import { NodeSettings } from "./lazyNodeSettings";
import { useCallback, useMemo, useState, useSyncExternalStore, type FocusEvent } from "react";
import { planningHost } from "../../planning/host";
import { NodePlanning } from "../../planning/lazy";
import { DockIdentity } from "./DockIdentity";
import { ContextMenu } from "../../components/ContextMenu";
import { stencilMenu } from "../../editor/builtinActions";
import { t, useLocale } from "../../i18n";
import { getStencil } from "../../stencils/registry";
import type { DiagramFlowNode } from "../types";
import type { InspectorProps } from "./types";
import { useNameFields } from "./useNameFields";
import { NodeIdentity } from "./lazyNodeIdentity";

export function NodePanel({
  node,
  editor,
  groups,
  connection,
  onNamed,
  findings,
  revision,
  counts,
  readDiagram,
  meta,
  focus,
  checksStore,
}: InspectorProps & { node: DiagramFlowNode }) {
  useLocale();
  const liveMode = useSyncExternalStore(planningHost.subscribe, () => !!planningHost.get());
  const warnings = useSyncExternalStore(
    checksStore?.subscribe ?? noSubscribe,
    () =>
      checksStore
        ?.get()
        .byElement.get(node.id)
        ?.filter((f) => f.severity === "warning").length ?? 0,
  );
  const [editing, setEditing] = useState({ live: liveMode, seq: focus?.seq, open: !liveMode });
  if (editing.live !== liveMode) setEditing({ live: liveMode, seq: focus?.seq, open: !liveMode });
  else if (focus?.seq !== editing.seq) setEditing({ ...editing, seq: focus?.seq, open: true });
  const stencil = getStencil(node.data.stencil);
  // A new node keeps its creation step while these name fields are focused.
  const [textActive, setTextActive] = useState<"name" | "description" | null>(null);
  const namingActive = textActive !== null;
  const onDescriptionFocus = useCallback(() => setTextActive("description"), []);
  const onDescriptionBlur = useCallback(
    () => setTextActive((current) => (current === "description" ? null : current)),
    [],
  );
  const done = useCallback(() => {
    setTextActive((current) => (current === "name" ? null : current));
    onNamed?.();
  }, [onNamed]);
  const naming = useNameFields(editor, "node", node.id, node.id, done);
  const nameKeys = useMemo(
    () => ({
      ...naming.keys,
      onFocus: (e: FocusEvent<HTMLInputElement>) => {
        setTextActive("name");
        naming.keys.onFocus(e);
      },
    }),
    [naming.keys],
  );
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);

  // The paused settings keep the same reader and revision during identity edits. Memoize
  // the element too, so the lazy boundary adds no work to each naming keystroke.
  const nodeId = node.id;
  const stencilId = node.data.stencil;
  const nodeProps = node.data.props;
  const settingsRevision = namingActive ? undefined : (revision ?? node);
  const settingsRead = namingActive ? editor.getDiagram : readDiagram;
  const settings = useMemo(
    () => (
      <NodeSettings
        nodeId={nodeId}
        stencilId={stencilId}
        nodeProps={nodeProps}
        editor={editor}
        revision={settingsRevision}
        counts={counts}
        readDiagram={settingsRead}
        meta={meta}
        focus={focus}
        namingActive={namingActive}
        liveMode={liveMode}
      />
    ),
    [nodeId, stencilId, nodeProps, editor, settingsRevision, counts, settingsRead, meta, focus, namingActive, liveMode],
  );

  return (
    <>
      {liveMode ? (
        <NodePlanning
          id={node.id}
          editor={editor}
          revision={revision}
          readDiagram={readDiagram}
          counts={counts}
          liveOnly
        />
      ) : (
        <DockIdentity node={node.data} warnings={warnings} />
      )}
      {liveMode && (
        <button
          className="dock-edit-properties"
          data-testid="dock-edit-properties"
          aria-expanded={editing.open}
          onClick={() => setEditing({ ...editing, open: !editing.open })}
        >
          {t("workbench.editProperties")} ›
        </button>
      )}
      {(!liveMode || editing.open) && (
        <>
          {findings}
          <NodeIdentity
            node={node}
            editor={editor}
            groups={groups}
            connection={connection}
            stencil={stencil}
            naming={naming}
            nameKeys={nameKeys}
            setPicker={setPicker}
            onDescriptionFocus={onDescriptionFocus}
            onDescriptionBlur={onDescriptionBlur}
          />

          {settings}
        </>
      )}

      {picker && (
        <ContextMenu
          x={picker.x}
          y={picker.y}
          label={t("inspector.changeStencil")}
          testId="stencil-picker"
          searchable={t("inspector.searchStencils")}
          items={stencilMenu(
            "pick-stencil",
            (s) => ({ checked: s.id === node.data.stencil, run: () => editor.updateNode(node.id, { stencil: s.id }) }),
            stencil.category,
          )}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

const noSubscribe = () => () => {};
