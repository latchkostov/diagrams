import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ColorPickerModal } from "../components/ColorPickerModal";
import { ContextMenu } from "../components/ContextMenu";
import { Dropdown } from "../components/Dropdown";
import { Icon, type IconName } from "../components/Icon";
import { StencilIcon } from "../components/StencilIcon";
import type { AlignMode } from "../editor/arrange";
import { stencilMenu } from "../editor/builtinActions";
import { RELATION_CHOICES, applyChoice, choiceOf } from "../editor/relationActions";
import type { EditorApi } from "../editor/types";
import { t, useLocale } from "../i18n";
import { colorLabel, kindLabel, shapeLabel, toneLabel } from "../i18n/chrome";
import { stencilLabel } from "../i18n/stencils";
import { managedKind } from "../model/admissionPresets";
import { ANNOTATION_LIMITS } from "../model/annotations";
import { brokerSpec } from "../model/brokers";
import { eligibleParentGroupIds } from "../model/groupHierarchy";
import { BulkAdmissionFields, PlanningUpgrade, RequestRoutesSection } from "../planning/lazy";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import { getStencil } from "../stencils/registry";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_IDS,
  ANNOTATION_SHAPES,
  ANNOTATION_TEXT_SIZES,
  annotationColor,
  minSize,
  resolveAnnotationColor,
  textSizeLabel,
} from "./annotations";
import { isPresetGroupTone, resolveGroupTone, toneColor } from "./groupTones";
import { BulkRow, BulkSwatches, CopyId, Field, Section, Segmented, SizeInput } from "./inspector/controls";
import { Disclosure } from "./inspector/Disclosure";
import { EdgePanel } from "./inspector/EdgePanel";
import {
  MIXED,
  MIXED_VALUE,
  bulkStep,
  countLabel,
  countText,
  relationDropdownItems,
  shared,
} from "./inspector/helpers";
import { NodePanel } from "./inspector/NodePanel";
import { SIM_FIELDS, showSim } from "./inspector/simFields";
import { SimInput } from "./inspector/SimInput";
import { type InspectorProps } from "./inspector/types";
import { useNameFields } from "./inspector/useNameFields";
import { SheetResizeHandle } from "./SheetResizeHandle";
import { nodeSimFields } from "./simFieldRules";
import type { AnnotationFlowNode, GroupFlowNode, GroupTone } from "./types";

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

function GroupPanel({ group, editor, groups }: InspectorProps & { group: GroupFlowNode }) {
  const naming = useNameFields(editor, "group", group.data.groupId, group.id);
  const id = group.data.groupId;
  const isCustomTone = !isPresetGroupTone(group.data.tone) && Boolean(group.data.tone);
  const resolvedTone = resolveGroupTone(group.data.tone);
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const eligibleParents = useMemo(
    () =>
      eligibleParentGroupIds(
        id,
        groups.map((g) => ({ id: g.data.groupId, group: g.data.group })),
      ),
    [id, groups],
  );

  return (
    <Section>
      <Field label={t("inspector.label")}>
        <input
          className="insp-input"
          value={group.data.label}
          onChange={(e) => editor.updateGroup(id, { label: e.target.value }, naming.merge())}
          {...naming.keys}
          name="group-label"
          data-testid="inspector-field-label"
        />
      </Field>
      <Field label={t("inspector.colour")} group>
        <div
          className="insp-tones"
          data-testid="inspector-field-tone"
          role="radiogroup"
          aria-label={t("inspector.colour")}
        >
          {(Object.keys(toneColor) as GroupTone[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={group.data.tone === t}
              className={`insp-tone${group.data.tone === t ? " is-on" : ""}`}
              style={{ "--tone": toneColor[t] } as CSSProperties}
              title={toneLabel[t]}
              aria-label={toneLabel[t]}
              onClick={() => editor.updateGroup(id, { tone: t })}
              data-testid={`inspector-tone-${t}`}
            />
          ))}
          <button
            type="button"
            className={`insp-tone-custom${isCustomTone ? " is-on" : ""}`}
            title={t("chrome.customColour")}
            aria-label={t("chrome.customColour")}
            aria-haspopup="dialog"
            onClick={(e) =>
              setPickerAnchor({ rect: e.currentTarget.getBoundingClientRect(), merge: `inspector:group:${id}:tone` })
            }
            data-testid="inspector-tone-custom-btn"
          >
            <span
              className={`insp-tone-custom-swatch${!isCustomTone ? " insp-tone-custom-rainbow" : ""}`}
              style={isCustomTone ? { backgroundColor: resolvedTone } : undefined}
            />
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
      </Field>
      {pickerAnchor && (
        <ColorPickerModal
          currentColor={group.data.tone}
          defaultColor={resolvedTone}
          anchorRect={pickerAnchor.rect}
          onSelect={(hex) => editor.updateGroup(id, { tone: hex }, pickerAnchor)}
          onReset={() => {
            editor.updateGroup(id, { tone: undefined }, pickerAnchor);
            setPickerAnchor(null);
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      <Field label={t("inspector.size")} group>
        <div className="insp-size">
          <SizeInput
            label={t("inspector.width")}
            value={group.width ?? group.measured?.width ?? 0}
            min={160}
            testId="inspector-field-width"
            onCommit={(width) => editor.updateGroup(id, { width }, { adopt: true })}
          />
          <span aria-hidden>{"×"}</span>
          <SizeInput
            label={t("inspector.height")}
            value={group.height ?? group.measured?.height ?? 0}
            min={100}
            testId="inspector-field-height"
            onCommit={(height) => editor.updateGroup(id, { height }, { adopt: true })}
          />
        </div>
      </Field>
      <Field label={t("inspector.boundary")}>
        <select
          className="insp-input"
          value={group.data.group ?? ""}
          onChange={(e) => editor.updateGroup(id, { group: e.target.value || undefined })}
          name="group"
          data-testid="inspector-field-group"
        >
          <option value="">{t("inspector.none")}</option>
          {groups
            .filter((g) => eligibleParents.has(g.data.groupId))
            .map((g) => (
              <option key={g.id} value={g.data.groupId}>
                {g.data.label}
              </option>
            ))}
        </select>
      </Field>
      <div className="insp-actions">
        <button className="btn" onClick={() => editor.fitGroupToContents(id)} data-testid="inspector-group-fit">
          <Icon name="fit" size={14} /> {t("inspector.fitToContents")}
        </button>
        <button className="btn" onClick={() => editor.convertGroupToZone(id)} data-testid="inspector-group-convert">
          <Icon name="zone" size={14} /> {t("inspector.convertToZone")}
        </button>
        <button className="btn" onClick={() => editor.ungroup(id)} data-testid="inspector-group-ungroup">
          <Icon name="ungroup" size={14} /> {t("inspector.removeBoundary")}
        </button>
      </div>
      <CopyId id={id} />
    </Section>
  );
}

function AnnotationPanel({ note, editor, groups, onTextSettled }: InspectorProps & { note: AnnotationFlowNode }) {
  const id = note.id;
  const { kind } = note.data;
  const merge = (f: string) => ({ merge: `inspector:annotation:${id}:${f}` });
  const color = annotationColor(note.data);
  const resolved = resolveAnnotationColor(note.data.color, kind);
  const isCustomColor = !resolved.isPreset;
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const min = minSize[kind];
  /** The text's box as it is now (before an edit that may grow it). */
  const boxNow = () => ({
    x: note.position.x,
    y: note.position.y,
    width: note.width ?? note.measured?.width ?? 0,
    height: note.height ?? note.measured?.height ?? 0,
  });
  // Typing grows a text as you go; once you're done, it moves clear if it grew over something.
  const typedFrom = useRef<ReturnType<typeof boxNow> | null>(null);
  return (
    <Section>
      <Field label={kind === "zone" ? t("inspector.label") : t("inspector.text")}>
        {kind === "zone" ? (
          <input
            className="insp-input"
            value={note.data.text}
            placeholder={t("inspector.zoneName")}
            onChange={(e) => editor.updateAnnotation(id, { text: e.target.value }, merge("text"))}
            maxLength={ANNOTATION_LIMITS.maxAnnotationText}
            name="annotation-text"
            data-testid="inspector-field-label"
          />
        ) : (
          <textarea
            className="insp-input"
            rows={3}
            value={note.data.text}
            placeholder={t("inspector.writeSomething")}
            onFocus={() => (typedFrom.current = kind === "text" ? boxNow() : null)}
            onBlur={() => {
              if (typedFrom.current) onTextSettled?.(id, typedFrom.current);
              typedFrom.current = null;
            }}
            onChange={(e) => editor.updateAnnotation(id, { text: e.target.value }, merge("text"))}
            maxLength={ANNOTATION_LIMITS.maxAnnotationText}
            name="annotation-text"
            data-testid="inspector-field-text"
          />
        )}
      </Field>
      {kind === "shape" && (
        <Field label={t("inspector.shape")} group>
          <div
            className="insp-toolbar"
            role="radiogroup"
            aria-label={t("inspector.shape")}
            data-testid="inspector-field-shape"
          >
            {ANNOTATION_SHAPES.map((sh) => (
              <button
                key={sh}
                type="button"
                role="radio"
                aria-checked={(note.data.shape ?? "rect") === sh}
                className={`icon-btn${(note.data.shape ?? "rect") === sh ? " is-on" : ""}`}
                title={shapeLabel[sh]}
                aria-label={shapeLabel[sh]}
                onClick={() => editor.updateAnnotation(id, { shape: sh })}
                data-testid={`inspector-shape-${sh}`}
              >
                <Icon name={`shape-${sh}`} />
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label={t("inspector.colour")} group>
        <div
          className="insp-tones"
          data-testid="inspector-field-color"
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
              onClick={() => editor.updateAnnotation(id, { color: c })}
              data-testid={`inspector-color-${c}`}
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
            data-testid="inspector-color-custom-btn"
          >
            <span
              className={`insp-tone-custom-swatch${!isCustomColor ? " insp-tone-custom-rainbow" : ""}`}
              style={isCustomColor ? { backgroundColor: resolved.hex } : undefined}
            />
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
      </Field>
      {pickerAnchor && (
        <ColorPickerModal
          currentColor={note.data.color}
          defaultColor={resolved.hex}
          anchorRect={pickerAnchor.rect}
          onSelect={(hex) => editor.updateAnnotation(id, { color: hex }, pickerAnchor)}
          onReset={() => {
            editor.updateAnnotation(id, { color: undefined }, pickerAnchor);
            setPickerAnchor(null);
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      {/* A zone's label is a label, like a boundary's: one size. */}
      {kind !== "zone" && (
        <Field label={t("inspector.textSize")} group>
          <Segmented
            testId="inspector-field-text-size"
            label={t("inspector.textSize")}
            value={note.data.textSize ?? "m"}
            options={ANNOTATION_TEXT_SIZES.map((t) => ({ value: t, label: textSizeLabel[t] }))}
            onChange={(textSize) => {
              const before = boxNow();
              editor.updateAnnotation(id, { textSize });
              if (kind === "text") onTextSettled?.(id, before);
            }}
          />
        </Field>
      )}
      {/* Text sizes itself from what you type and its text size (the handles still set its width). */}
      {kind !== "text" && (
        <Field label={t("inspector.size")} group>
          <div className="insp-size">
            <SizeInput
              label={t("inspector.width")}
              value={note.width ?? note.measured?.width ?? 0}
              min={min.width}
              testId="inspector-field-width"
              onCommit={(width) => editor.updateAnnotation(id, { width })}
            />
            <span aria-hidden>{"×"}</span>
            <SizeInput
              label={t("inspector.height")}
              value={note.height ?? note.measured?.height ?? 0}
              min={min.height}
              testId="inspector-field-height"
              onCommit={(height) => editor.updateAnnotation(id, { height })}
            />
          </div>
        </Field>
      )}
      <p className="insp-note" data-testid="inspector-annotation-hint">
        {kind === "zone"
          ? t("inspector.aZoneOnlyMarksAnAreaNodesDonT")
          : t("inspector.annotationsDonTTakePartInTheSimulation")}
      </p>
      {kind === "zone" && (
        <div className="insp-actions">
          <button className="btn" onClick={() => editor.convertZoneToBoundary(id)} data-testid="inspector-zone-convert">
            <Icon name="boundary" size={14} /> {t("inspector.convertToBoundary")}
          </button>
        </div>
      )}
      <Field label={t("inspector.boundary")}>
        <select
          className="insp-input"
          value={note.data.group ?? ""}
          onChange={(e) => editor.updateAnnotation(id, { group: e.target.value || undefined })}
          name="group"
          data-testid="inspector-field-group"
        >
          <option value="">{t("inspector.none")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.data.groupId}>
              {g.data.label}
            </option>
          ))}
        </select>
      </Field>
      <CopyId id={id} />
    </Section>
  );
}

const ALIGN_BUTTONS: { mode: AlignMode; icon: IconName; label: string }[] = [
  {
    mode: "left",
    icon: "align-left",
    get label() {
      return t("inspector.alignLeft");
    },
  },
  {
    mode: "center",
    icon: "align-center",
    get label() {
      return t("inspector.alignCentres");
    },
  },
  {
    mode: "right",
    icon: "align-right",
    get label() {
      return t("inspector.alignRight");
    },
  },
  {
    mode: "top",
    icon: "align-top",
    get label() {
      return t("inspector.alignTop");
    },
  },
  {
    mode: "middle",
    icon: "align-middle",
    get label() {
      return t("inspector.alignMiddles");
    },
  },
  {
    mode: "bottom",
    icon: "align-bottom",
    get label() {
      return t("inspector.alignBottom");
    },
  },
];

function MultiPanel(p: InspectorProps) {
  const { editor, selectedNodes, selectedEdges, selectedGroups, selectedAnnotations = [] } = p;
  const nodeIds = selectedNodes.map((n) => n.id);
  const groupableIds = [
    ...nodeIds,
    ...selectedAnnotations.map((a) => a.id),
    ...selectedGroups.map((g) => g.data.groupId),
  ];
  // Align and distribute arrange nodes and annotations alike; Tidy up lays out nodes (and their edges).
  const ids = [...nodeIds, ...selectedAnnotations.map((n) => n.id)];
  return (
    <>
      <Section>
        {ids.length > 1 ? (
          <Field label={t("inspector.arrange")} group>
            <div className="insp-toolbar">
              {ALIGN_BUTTONS.map((a) => (
                <button
                  key={a.mode}
                  className="icon-btn"
                  title={a.label}
                  aria-label={a.label}
                  onClick={() => editor.align(ids, a.mode)}
                  data-testid={`inspector-align-${a.mode}`}
                >
                  <Icon name={a.icon} />
                </button>
              ))}
            </div>
            {ids.length > 2 && (
              <div className="insp-toolbar">
                <button
                  className="icon-btn"
                  title={t("inspector.distributeHorizontally")}
                  aria-label={t("inspector.distributeHorizontally")}
                  onClick={() => editor.distribute(ids, "h")}
                  data-testid="inspector-distribute-h"
                >
                  <Icon name="distribute-h" />
                </button>
                <button
                  className="icon-btn"
                  title={t("inspector.distributeVertically")}
                  aria-label={t("inspector.distributeVertically")}
                  onClick={() => editor.distribute(ids, "v")}
                  data-testid="inspector-distribute-v"
                >
                  <Icon name="distribute-v" />
                </button>
                {nodeIds.length > 2 && (
                  <button
                    className="btn insp-tidy"
                    title={t("inspector.layOutJustTheseNodesByTheirConnectionsNothing")}
                    onClick={() => editor.tidy(nodeIds)}
                    data-testid="inspector-tidy"
                  >
                    <Icon name="layout" size={14} /> {t("inspector.tidyUp")}
                  </button>
                )}
              </div>
            )}
          </Field>
        ) : (
          <p className="insp-note">
            {countText(selectedNodes.length, selectedEdges.length, selectedGroups.length, selectedAnnotations.length)}
          </p>
        )}
      </Section>
      {selectedNodes.length > 0 && <BulkNodes {...p} />}
      {selectedEdges.length > 0 && <BulkEdges {...p} />}
      {selectedAnnotations.length > 0 && (
        <Section title={countLabel(selectedAnnotations.length, "annotation")}>
          <BulkAnnotations selectedAnnotations={selectedAnnotations} editor={editor} />
        </Section>
      )}
      {selectedGroups.length > 0 && (
        <Section title={countLabel(selectedGroups.length, "boundary")}>
          <BulkGroups selectedGroups={selectedGroups} editor={editor} />
        </Section>
      )}
      <Section>
        <div className="insp-actions">
          {groupableIds.length > 0 && (
            <button
              className="btn"
              onClick={() => editor.groupNodes(groupableIds)}
              data-testid="inspector-group-selection"
            >
              <Icon name="boundary" size={14} /> {t("inspector.addBoundary")}
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={() =>
              editor.deleteElements({
                nodeIds: ids,
                edgeIds: selectedEdges.map((e) => e.id),
                groupIds: selectedGroups.map((g) => g.data.groupId),
              })
            }
            data-testid="inspector-delete-selection"
          >
            <Icon name="trash" size={14} /> {t("inspector.delete")}
          </button>
        </div>
      </Section>
    </>
  );
}

/** The fields several nodes share (D11): Stencil, Boundary, and the simulation settings their roles have in common. */
function BulkNodes({ editor, selectedNodes, groups, meta }: InspectorProps) {
  const ids = selectedNodes.map((n) => n.id);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const stencilId = shared(selectedNodes, (n) => n.data.stencil);
  const stencil = typeof stencilId === "string" ? getStencil(stencilId) : null;
  const group = shared(selectedNodes, (n) => n.data.group ?? "");
  const fields = selectedNodes.map((n) =>
    nodeSimFields(getStencil(n.data.stencil).simRole, n.data.stencil, meta.planning, n.data.props),
  );
  const simKeys = fields[0].filter((k) => fields.every((keys) => keys.includes(k)));
  const assignmentLabels = [
    ...new Set(
      selectedNodes.map((n) =>
        assignmentLabel(brokerSpec(n.data.stencil, getStencil(n.data.stencil).simRole, meta.planning)),
      ),
    ),
  ].join(" / ");
  const mergeKey = ids.join(",");
  const managed =
    (meta.planning?.revision === "p3" || meta.planning?.revision === "p3-a1") &&
    selectedNodes.every((node) => !!managedKind(node.data.stencil));
  return (
    <>
      <Section title={countLabel(ids.length, "node")}>
        <BulkRow label={t("inspector.stencil")}>
          <button
            className="insp-stencil insp-stencil-compact"
            data-testid="inspector-field-stencil"
            data-mixed={stencil ? undefined : "true"}
            aria-label={t("inspector.bulkStencil", {
              stencil: stencil ? stencilLabel(stencil) : t("inspector.mixed"),
              count: ids.length,
            })}
            aria-haspopup="menu"
            style={stencil ? ({ "--accent": stencil.accent } as CSSProperties) : undefined}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicker({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <span className="palette-tile">
              {stencil ? <StencilIcon stencil={stencil} size={16} /> : <Icon name="shapes" size={14} />}
            </span>
            <span className="insp-stencil-name">
              {stencil ? stencilLabel(stencil) : <em className="insp-mixed">{t("inspector.mixed")}</em>}
            </span>
            <Icon name="chevron-down" size={14} />
          </button>
        </BulkRow>
        <BulkRow label={t("inspector.boundary")}>
          <select
            className="insp-input"
            value={group === MIXED ? MIXED_VALUE : (group ?? "")}
            onChange={(e) =>
              e.target.value !== MIXED_VALUE &&
              editor.updateNodes(ids, { group: e.target.value || undefined }, bulkStep("group"))
            }
            name="group"
            aria-label={t("inspector.bulkBoundary", { count: ids.length })}
            data-testid="inspector-field-group"
          >
            {group === MIXED && (
              <option value={MIXED_VALUE} disabled>
                {t("inspector.mixed")}
              </option>
            )}
            <option value="">{t("inspector.none")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.data.groupId}>
                {g.data.label}
              </option>
            ))}
          </select>
        </BulkRow>
      </Section>
      {(simKeys.length > 0 || managed) && (
        <Disclosure id="multi-simulation" title={t("inspector.simulation")}>
          {managed && (
            <BulkAdmissionFields
              nodes={selectedNodes.map((node) => ({
                id: node.id,
                stencil: node.data.stencil,
                props: node.data.props ?? {},
              }))}
              set={(patches, key) =>
                editor.setNodesProps(ids, (_props, id) => patches[id], { merge: `bulk:${mergeKey}:${key}` })
              }
            />
          )}
          {simKeys.map((k) => {
            const value = shared(selectedNodes, (n) => showSim(SIM_FIELDS[k]!.kind, n.data.props?.[k]));
            const first = selectedNodes[0].data.props?.[k];
            return (
              <SimInput
                key={k}
                name={k}
                field={{
                  ...SIM_FIELDS[k]!,
                  ...(k === "partitions"
                    ? { label: assignmentLabels, hint: t("broker.assignmentHint"), note: undefined }
                    : {}),
                  ...(value === MIXED ? { placeholder: t("inspector.mixed") } : {}),
                }}
                value={value === MIXED ? undefined : first}
                onChange={(v) => editor.setNodesProps(ids, { [k]: v }, { merge: `bulk:${mergeKey}:${k}` })}
              />
            );
          })}
        </Disclosure>
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
            (s) => ({
              checked: s.id === stencilId,
              run: () => editor.updateNodes(ids, { stencil: s.id }, bulkStep("stencil")),
            }),
            stencil?.category ?? getStencil(selectedNodes[0].data.stencil).category,
          )}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

/** The fields several edges share (D11): Relationship and Label. */
function BulkEdges({ editor, selectedEdges }: InspectorProps) {
  const ids = selectedEdges.map((e) => e.id);
  const choice = shared(selectedEdges, (e) => choiceOf(e.data));
  const label = shared(selectedEdges, (e) => e.data?.label ?? "");
  return (
    <Section title={countLabel(ids.length, "edge")}>
      <BulkRow label={t("inspector.relationship")}>
        <Dropdown
          value={choice === MIXED ? undefined : choice}
          placeholder={choice === MIXED ? t("inspector.mixed") : undefined}
          onChange={(nextId) => {
            const next = RELATION_CHOICES.find((c) => c.id === nextId);
            if (next) applyChoice(editor, ids, next);
          }}
          items={relationDropdownItems()}
          name="relationship"
          aria-label={t("inspector.bulkRelationship", { count: ids.length })}
          testId="inspector-field-relation"
        />
      </BulkRow>
      <BulkRow label={t("inspector.label")}>
        <input
          className="insp-input"
          value={label === MIXED ? "" : (label ?? "")}
          placeholder={label === MIXED ? t("inspector.mixed") : t("inspector.eGOrderplaced")}
          onChange={(e) => editor.updateEdges(ids, { label: e.target.value }, { merge: `bulk:${ids.join(",")}:label` })}
          name="edge-label"
          aria-label={t("inspector.bulkLabel", { count: ids.length })}
          data-testid="inspector-field-label"
        />
      </BulkRow>
    </Section>
  );
}

function BulkGroups({ selectedGroups, editor }: { selectedGroups: GroupFlowNode[]; editor: EditorApi }) {
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const sharedTone = shared(selectedGroups, (g) => g.data.tone);
  const isCustom = typeof sharedTone === "string" && !isPresetGroupTone(sharedTone) && sharedTone.startsWith("#");
  const resolved = resolveGroupTone(sharedTone === MIXED ? undefined : sharedTone);

  return (
    <>
      <BulkSwatches
        testId="inspector-field-tone"
        itemTestId="inspector-tone"
        options={(Object.keys(toneColor) as GroupTone[]).map((t) => ({
          id: t,
          colour: toneColor[t],
          label: toneLabel[t],
        }))}
        value={sharedTone}
        onPick={(t) =>
          editor.updateGroups(
            selectedGroups.map((g) => g.data.groupId),
            { tone: t },
            bulkStep("tone"),
          )
        }
        customButton={
          <button
            type="button"
            className={`insp-tone-custom${isCustom ? " is-on" : ""}`}
            title={t("chrome.customColour")}
            aria-label={t("chrome.customColour")}
            aria-haspopup="dialog"
            onClick={(e) =>
              setPickerAnchor({ rect: e.currentTarget.getBoundingClientRect(), merge: bulkStep("tone").merge })
            }
            data-testid="inspector-tone-custom-btn"
          >
            <span
              className={`insp-tone-custom-swatch${!isCustom ? " insp-tone-custom-rainbow" : ""}`}
              style={isCustom ? { backgroundColor: resolved } : undefined}
            />
            <Icon name="chevron-down" size={12} />
          </button>
        }
      />
      {pickerAnchor && (
        <ColorPickerModal
          currentColor={sharedTone === MIXED ? undefined : sharedTone}
          defaultColor={resolved}
          anchorRect={pickerAnchor.rect}
          onSelect={(hex) =>
            editor.updateGroups(
              selectedGroups.map((g) => g.data.groupId),
              { tone: hex },
              pickerAnchor,
            )
          }
          onReset={() => {
            editor.updateGroups(
              selectedGroups.map((g) => g.data.groupId),
              { tone: undefined },
              pickerAnchor,
            );
            setPickerAnchor(null);
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </>
  );
}

function BulkAnnotations({
  selectedAnnotations,
  editor,
}: {
  selectedAnnotations: AnnotationFlowNode[];
  editor: EditorApi;
}) {
  const [pickerAnchor, setPickerAnchor] = useState<{ rect: DOMRect; merge: string } | null>(null);
  const sharedColor = shared(selectedAnnotations, (a) => annotationColor(a.data));
  const isCustom = typeof sharedColor === "string" && sharedColor.startsWith("#");
  const firstKind = selectedAnnotations[0]?.data.kind ?? "text";
  const resolved = resolveAnnotationColor(sharedColor === MIXED ? undefined : sharedColor, firstKind);

  return (
    <>
      <BulkSwatches
        testId="inspector-field-color"
        itemTestId="inspector-color"
        options={ANNOTATION_COLOR_IDS.map((c) => ({
          id: c,
          colour: ANNOTATION_COLORS[c].hex,
          label: colorLabel[c],
        }))}
        value={sharedColor}
        onPick={(c) =>
          editor.updateAnnotations(
            selectedAnnotations.map((a) => a.id),
            { color: c },
            bulkStep("annotation-colour"),
          )
        }
        customButton={
          <button
            type="button"
            className={`insp-tone-custom${isCustom ? " is-on" : ""}`}
            title={t("chrome.customColour")}
            aria-label={t("chrome.customColour")}
            aria-haspopup="dialog"
            onClick={(e) =>
              setPickerAnchor({ rect: e.currentTarget.getBoundingClientRect(), merge: bulkStep("colour").merge })
            }
            data-testid="inspector-color-custom-btn"
          >
            <span
              className={`insp-tone-custom-swatch${!isCustom ? " insp-tone-custom-rainbow" : ""}`}
              style={isCustom ? { backgroundColor: resolved.hex } : undefined}
            />
            <Icon name="chevron-down" size={12} />
          </button>
        }
      />
      {pickerAnchor && (
        <ColorPickerModal
          currentColor={sharedColor === MIXED ? undefined : sharedColor}
          defaultColor={resolved.hex}
          anchorRect={pickerAnchor.rect}
          onSelect={(hex) =>
            editor.updateAnnotations(
              selectedAnnotations.map((a) => a.id),
              { color: hex },
              pickerAnchor,
            )
          }
          onReset={() => {
            editor.updateAnnotations(
              selectedAnnotations.map((a) => a.id),
              { color: undefined },
              pickerAnchor,
            );
            setPickerAnchor(null);
          }}
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </>
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
