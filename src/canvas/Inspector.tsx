import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ColorPickerModal } from "../components/ColorPickerModal";
import { Icon } from "../components/Icon";
import { t, useLocale } from "../i18n";
import { colorLabel, kindLabel } from "../i18n/chrome";
import { PlanningUpgrade, RequestRoutesSection } from "../planning/lazy";
import { ANNOTATION_COLORS, ANNOTATION_COLOR_IDS, resolveAnnotationColor } from "./annotations";
import { AnnotationPanel } from "./inspector/AnnotationPanel";
import { Field, Section, Segmented } from "./inspector/controls";
import { EdgePanel } from "./inspector/EdgePanel";
import { GroupPanel } from "./inspector/GroupPanel";
import { bulkStep, countText } from "./inspector/helpers";
import { MultiPanel } from "./inspector/MultiPanel";
import { NodePanel } from "./inspector/NodePanel";
import { type InspectorProps } from "./inspector/types";
import { SheetResizeHandle } from "./SheetResizeHandle";

export function Inspector(p: InspectorProps) {
  useLocale();
  const body = useRef<HTMLDivElement>(null);

  // At once, so the next key typed reaches the field (F2 then a name; a double-click then a name), and again a
  // frame later only if something took focus back meanwhile (the menu that asked for it, closing). Not when the
  // person moved it (Enter straight after, a third click): a key or a press in between leaves focus where it went.
  // Each request once: one made while folded waits for the inspector to open, and folding and opening again later
  // (a selection changing under it) never repeats it.
  const done = useRef(0);
  const takeFocus = p.takeFocus;
  const selectionKey = JSON.stringify([
    p.selectedNodes.map((n) => n.id),
    p.selectedGroups.map((n) => n.id),
    p.selectedEdges.map((e) => e.id),
    (p.selectedAnnotations ?? []).map((n) => n.id),
  ]);
  useLayoutEffect(() => {
    if (!p.focus || p.collapsed || done.current === p.focus.seq) return;
    const { name, caret, target } = p.focus;
    const field = body.current?.querySelector<HTMLElement>(`[data-testid="inspector-field-${name}"]`);
    // React Flow's selection can arrive after the panel opens. Keep the request pending until the
    // requested field is mounted for that selection, rather than consuming it on the diagram/old panel.
    if (!field || (target && field.getAttribute("data-name-field") !== target)) return;
    if (takeFocus && !takeFocus(p.focus.seq)) return;
    done.current = p.focus.seq;
    const place = (retry = false) => {
      const el = body.current?.querySelector<HTMLElement>(`[data-testid="inspector-field-${name}"]`);
      if (!el || (retry && document.activeElement === el)) return;
      el.focus();
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      if (caret === "end") el.setSelectionRange(el.value.length, el.value.length);
      else el.select();
    };
    place();
    let moved = false;
    const onInput = () => (moved = true);
    const stop = () => {
      window.removeEventListener("keydown", onInput, true);
      window.removeEventListener("pointerdown", onInput, true);
    };
    window.addEventListener("keydown", onInput, true);
    window.addEventListener("pointerdown", onInput, true);
    const id = requestAnimationFrame(() => {
      stop();
      if (!moved) place(true);
    });
    return () => {
      cancelAnimationFrame(id);
      stop();
    };
  }, [p.focus, p.collapsed, takeFocus, selectionKey]);

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
      <div className="insp-body" ref={body} data-testid="inspector-body" data-check-fallback-scope>
        {n === 1 && !p.selectedNodes[0] && p.findings}
        {content}
      </div>
    </aside>
  );
}

function DiagramPanel({ editor, meta, counts, focus, takeFocus }: InspectorProps) {
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const color = meta.color;
  const isCustomColor = !!color && !ANNOTATION_COLOR_IDS.includes(color as (typeof ANNOTATION_COLOR_IDS)[number]);
  const resolved = color ? resolveAnnotationColor(color) : null;

  return (
    <>
      <RequestRoutesSection editor={editor} planning={meta.planning} place="live" />
      <PlanningUpgrade
        editor={editor}
        planning={meta.planning}
        key={focus?.seq ?? "default"}
        initialPreview={focus?.name === "autoscaling-upgrade-preview"}
        takePreviewFocus={focus ? () => takeFocus?.(focus.seq) ?? true : undefined}
      />
      <Section>
        <Field label={t("inspector.title")}>
          <input
            className="insp-input"
            value={meta.title}
            onChange={(e) => editor.updateMeta({ title: e.target.value }, { merge: "inspector:meta:title" })}
            name="title"
            data-testid="inspector-field-title"
          />
        </Field>
        <Field label={t("inspector.description")}>
          <textarea
            className="insp-input"
            rows={3}
            value={meta.description ?? ""}
            placeholder={t("inspector.whatDoesThisDiagramShow")}
            onChange={(e) =>
              editor.updateMeta({ description: e.target.value || undefined }, { merge: "inspector:meta:description" })
            }
            name="description"
            data-testid="inspector-field-description"
          />
        </Field>
        <Field label={t("inspector.colour")} hint={t("chrome.canvasBackgroundTint")} group>
          <div
            className="insp-tones"
            data-testid="inspector-field-diagram-color"
            role="radiogroup"
            aria-label={t("inspector.colour")}
          >
            {ANNOTATION_COLOR_IDS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={`insp-tone${color === c ? " is-on" : ""}`}
                style={{ "--tone": ANNOTATION_COLORS[c].hex } as CSSProperties}
                title={colorLabel[c]}
                aria-label={colorLabel[c]}
                data-color={c}
                onClick={() => editor.updateMeta({ color: color === c ? undefined : c })}
                data-testid={`inspector-diagram-color-${c}`}
              />
            ))}
            <button
              type="button"
              className={`insp-tone-custom${isCustomColor ? " is-on" : ""}`}
              title={t("chrome.customColour")}
              aria-label={t("chrome.customColour")}
              aria-haspopup="dialog"
              onClick={(e) =>
                setPickerAnchor({ rect: e.currentTarget.getBoundingClientRect(), merge: bulkStep("colour").merge })
              }
              data-testid="inspector-diagram-color-custom-btn"
            >
              <span
                className={`insp-tone-custom-swatch${!isCustomColor ? " insp-tone-custom-rainbow" : ""}`}
                style={isCustomColor && resolved ? { backgroundColor: resolved.hex } : undefined}
              />
              <Icon name="chevron-down" size={12} />
            </button>
          </div>
        </Field>
        {pickerAnchor && (
          <ColorPickerModal
            currentColor={color}
            defaultColor="#3B82F6"
            anchorRect={pickerAnchor.rect}
            onSelect={(hex) => editor.updateMeta({ color: hex }, pickerAnchor)}
            onReset={() => {
              editor.updateMeta({ color: undefined }, pickerAnchor);
              setPickerAnchor(null);
            }}
            onClose={() => setPickerAnchor(null)}
          />
        )}
        <Field
          label={t("inspector.flowDirection")}
          hint={t("inspector.edgesPreferThisAxisWhenPickingSidesAutoLayout")}
          group
        >
          <Segmented
            testId="inspector-field-direction"
            label={t("inspector.flowDirection")}
            value={meta.direction ?? "LR"}
            options={[
              { value: "LR", label: t("inspector.leftRight") },
              { value: "TB", label: t("inspector.topBottom") },
            ]}
            onChange={(direction) => editor.updateMeta({ direction })}
          />
        </Field>
      </Section>
      <RequestRoutesSection editor={editor} planning={meta.planning} place="edit" />
      <Section>
        <p className="insp-note">{countText(counts.nodes, counts.edges, counts.groups)}</p>
        <p className="insp-note">{t("inspector.selectANodeEdgeOrBoundaryToEditIt")}</p>
        <button className="link-btn" onClick={() => editor.showShortcuts()} data-testid="inspector-shortcuts">
          <Icon name="keyboard" size={13} /> {t("inspector.keyboardShortcuts")}
        </button>
      </Section>
    </>
  );
}

export type { InspectorProps } from "./inspector/types";
