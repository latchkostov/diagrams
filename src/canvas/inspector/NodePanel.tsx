import { NodeSettings } from "./lazyNodeSettings";
import { useCallback, useMemo, useState, type FocusEvent } from "react";
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
}: InspectorProps & { node: DiagramFlowNode }) {
  useLocale();
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

  return (
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

      <NodeSettings
        node={node}
        editor={editor}
        revision={revision}
        counts={counts}
        readDiagram={readDiagram}
        meta={meta}
        focus={focus}
        namingActive={namingActive}
      />

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
