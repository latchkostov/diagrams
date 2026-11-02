import { useId, useState } from "react";
import { useStore, useStoreApi, ViewportPortal } from "@xyflow/react";
import { Dialog } from "../../interop/ui/Dialog";
import { t, useLocale } from "../../i18n";
import { surfaceCatalogs } from "../../i18n/surfaces";
import { createMachine } from "../../lib/machine";
import type { EditorApi } from "../../editor/types";
import { pickArea, pickCount, type SelectionPick } from "../../editor/selectionCommands";
import { GROUP_PREFIX, type DiagramFlowEdge, type FlowNode } from "../types";
import { useInteraction } from "../interaction/context";
import { dependencyVisibility } from "../dependencyVisibility";
import { isDependency } from "../../model/relations";
import { readingOrder } from "../keyboardNav";
import { selectionBoxes } from "./selectionBoxes";
import { areaDialogMachine } from "./areaDialogMachine";
import "./selectionArea.css";

export interface SelectionAreaProps {
  editor: EditorApi;
  direction: "LR" | "TB";
  onClose(reason?: "escape" | "pick"): void;
}

function NodePicker({
  name,
  value,
  onChange,
  options,
}: {
  name: "from" | "to";
  value: string;
  onChange(id: string): void;
  options: { id: string; label: string }[];
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const label = name === "from" ? t("selection.from") : t("selection.to");
  const matches = options.filter(
    (n) => n.id === value || `${n.label} ${n.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <div className="selection-area-picker">
      <label htmlFor={id}>{label}</label>
      <div className="field">
        <input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("menu.searchNodes")}
          data-autofocus={name === "from" ? "" : undefined}
          data-testid={`selection-area-${name}-search`}
        />
      </div>
      <div className="select">
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`selection-area-${name}`}
        >
          {matches.map((n) => (
            <option key={n.id} value={n.id} data-testid={`selection-area-${name}-${n.id}`}>
              {n.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SelectionAreaDialog({ editor, direction, onClose }: SelectionAreaProps) {
  useLocale();
  const store = useStoreApi<FlowNode, DiagramFlowEdge>();
  useStore((s) => s.nodes);
  useStore((s) => s.edges);
  const interaction = useInteraction();
  const [session] = useState(() => createMachine(areaDialogMachine));
  const state = store.getState();
  const items = selectionBoxes(state);
  const order = readingOrder(
    items.filter((n) => state.nodeLookup.get(n.id)?.type === "diagram"),
    direction,
  );
  const options = order.map((n) => ({
    id: n.id,
    label: String((state.nodeLookup.get(n.id)?.data as { label?: string })?.label || n.id),
  }));
  const [ends, setEnds] = useState(() => {
    const selected = new Set(editor.getSelection().nodeIds);
    const picked = order.filter((n) => selected.has(n.id));
    const extremes = picked.length ? picked : order;
    return { from: extremes[0]?.id ?? "", to: extremes.at(-1)?.id ?? "" };
  });
  const [contain, setContain] = useState(true);
  const [add, setAdd] = useState(false);
  const selection = editor.getSelection();
  const base: SelectionPick = {
    nodes: [...selection.nodeIds, ...selection.groupIds.map((id) => GROUP_PREFIX + id)],
    edges: selection.edgeIds,
  };
  const edges = state.edges.filter((e) => dependencyVisibility.get() || !isDependency(e.data));
  const preview = pickArea(items, edges, ends.from, ends.to, contain, add ? base : undefined);
  const count = preview ? pickCount(preview.pick) : 0;
  const cancel = () => {
    session.send({ type: "cancel" });
    onClose("escape");
  };
  return (
    <>
      {preview && (
        <ViewportPortal>
          <div
            className="landing-outline selection-area-outline"
            aria-hidden
            data-testid="selection-area-outline"
            style={{
              transform: `translate(${preview.rect.x}px, ${preview.rect.y}px)`,
              width: preview.rect.width,
              height: preview.rect.height,
            }}
          >
            <span>{t("inspector.selectedCount", { count })}</span>
          </div>
        </ViewportPortal>
      )}
      <Dialog
        title={t("selection.area")}
        testId="selection-area"
        width={480}
        backdropClassName="selection-area-backdrop"
        onClose={cancel}
        restoreFocus={(opener) => {
          for (const command of session.send({ type: "dispose", opener }).commands)
            interaction?.dispatch({
              type: "dialog.closed",
              dialog: "selection",
              opener: command.opener,
              reason: command.reason,
            });
        }}
        footer={
          <>
            <button className="btn" data-testid="selection-area-cancel" onClick={cancel}>
              {t("common.cancel")}
            </button>
            <button
              className="btn btn-primary"
              data-testid="selection-area-select"
              disabled={!preview}
              onClick={() => {
                const accepted = editor.selectionTool({ type: "area", ...ends, contain, add });
                session.send({ type: "apply", accepted });
                if (accepted) onClose("pick");
              }}
            >
              {t("rail.select")}
            </button>
          </>
        }
      >
        <div className="selection-area-pickers">
          <NodePicker
            name="from"
            value={ends.from}
            onChange={(from) => setEnds((s) => ({ ...s, from }))}
            options={options}
          />
          <NodePicker name="to" value={ends.to} onChange={(to) => setEnds((s) => ({ ...s, to }))} options={options} />
        </div>
        <label className="selection-area-check">
          <input
            type="checkbox"
            checked={contain}
            onChange={(e) => setContain(e.target.checked)}
            data-testid="selection-area-wholly"
          />
          {t("selection.wholly")}
        </label>
        <label className="selection-area-check">
          <input
            type="checkbox"
            checked={add}
            onChange={(e) => setAdd(e.target.checked)}
            data-testid="selection-area-add"
          />
          {t("selection.add")}
        </label>
        <p role="status" aria-label={t("selection.preview")} data-testid="selection-area-preview">
          {preview ? t("inspector.selectedCount", { count }) : t("selection.unavailable")}
        </p>
      </Dialog>
    </>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- The loader awaits this surface’s optional catalog.
export async function selectionAreaWhenReady() {
  await surfaceCatalogs(["selection"]);
  return SelectionAreaDialog;
}
