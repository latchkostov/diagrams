import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ColorPickerModal } from "../components/ColorPickerModal";
import { ContextMenu } from "../components/ContextMenu";
import { Dropdown } from "../components/Dropdown";
import { Icon, type IconName } from "../components/Icon";
import { StencilIcon } from "../components/StencilIcon";
import type { AlignMode } from "../editor/arrange";
import { stencilMenu } from "../editor/builtinActions";
import { RELATION_CHOICES, applyChoice, choiceOf, relationIcon } from "../editor/relationActions";
import { routingIntent } from "../editor/routingIntent";
import type { EditorApi } from "../editor/types";
import { t, useLocale } from "../i18n";
import { colorLabel, kindLabel, relationLabel, shapeLabel, toneLabel } from "../i18n/chrome";
import { galleryRoleMeta as simRoleMeta } from "../i18n/galleryRoles";
import { stencilLabel, vendorLabel } from "../i18n/stencils";
import { SIM_LIMITS } from "../interop/native";
import { managedKind } from "../model/admissionPresets";
import { ANNOTATION_LIMITS } from "../model/annotations";
import { brokerSpec, isClusterWrapper } from "../model/brokers";
import { eligibleParentGroupIds } from "../model/groupHierarchy";
import {
  MAX_SETTINGS_TEXT,
  edgeSettings,
  isDependency,
  parseSettings,
  parseSettingsEditor,
  relationNote,
  relationOf,
  settingsSummary,
  settingsText,
  type ConfigSetting,
} from "../model/relations";
import { routeTableCapable, trafficMixCapable } from "../model/requestRouting";
import {
  AdmissionFields,
  BulkAdmissionFields,
  EdgeRouteFields,
  NodePlanning,
  PlanningUpgrade,
  RequestRoutesSection,
  RouteTableFields,
  TrafficMixFields,
} from "../planning/lazy";
import { DEFAULT_TRAVEL_MS } from "../sim/topology";
import type { NodeSimProps } from "../sim/types";
import { assignmentLabel, groupLabel } from "../stencils/brokerVocabulary";
import { deviceSpec, isDenyRule, isFirewallStencil } from "../stencils/netDevices";
import { getStencil } from "../stencils/registry";
import { inferRelation } from "../stencils/relations";
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
import { AutoscalingWorkload } from "./inspector/AutoscalingWorkload";
import {
  BulkRow,
  BulkSwatches,
  CopyId,
  Field,
  InertNote,
  Section,
  Segmented,
  SideSelect,
  SizeInput,
} from "./inspector/controls";
import { DeviceFields } from "./inspector/DeviceFields";
import { Disclosure } from "./inspector/Disclosure";
import {
  MIXED,
  MIXED_VALUE,
  bulkStep,
  countLabel,
  countText,
  customCount,
  formatInert,
  isFanOut,
  relationDropdownItems,
  shared,
} from "./inspector/helpers";
import { ADC_KEYS, DEVICE_KEYS, EDGE_KEYS, RULE_KEYS, SIM_FIELDS, SIM_KEYS, showSim } from "./inspector/simFields";
import { SimInput } from "./inspector/SimInput";
import { type InspectorProps } from "./inspector/types";
import { SheetResizeHandle } from "./SheetResizeHandle";
import { edgeSimFields, inertNodeProps, nodeSimFields } from "./simFieldRules";
import type { AnnotationFlowNode, DiagramFlowEdge, DiagramFlowNode, GroupFlowNode, GroupTone } from "./types";

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

// ---------------------------------------------------------------- panels

/**
 * A name field's keys (a node's Label, Subtitle and new Connection, a connection's or a boundary's Label): what's
 * typed is saved as it's typed, so Enter and Esc are both done. They hand focus back to the thing on the canvas
 * (`flowId`), so the next key acts on it, as after a rename anywhere else. A node's naming (`nodeId`) is done then,
 * or when focus leaves its name fields: a creation step still open on it closes, and `onDone` runs.
 */
function useNameFields(
  editor: EditorApi,
  kind: "node" | "edge" | "group",
  id: string,
  flowId: string,
  onDone?: () => void,
) {
  const tag = useRef<string | undefined>(undefined);
  const field = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(
    () => () => {
      const input = field.current;
      const ending = tag.current;
      // StrictMode replays effects while the field stays mounted. Close only after a real removal.
      queueMicrotask(() => {
        if (ending && !input?.isConnected) {
          editor.doneNaming(ending);
          onDone?.();
        }
      });
    },
    [editor, onDone],
  );
  const done = () => {
    if (tag.current) editor.doneNaming(tag.current);
    tag.current = undefined;
    onDone?.();
  };
  const keys = {
    "data-name-field": flowId,
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      field.current = e.currentTarget;
      tag.current ??= editor.beginNaming(kind, id);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if ((e.key !== "Enter" && e.key !== "Escape") || e.nativeEvent.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      const field = e.currentTarget;
      field.setSelectionRange(field.value.length, field.value.length);
      const sel = `.react-flow__node[data-id="${CSS.escape(flowId)}"], .react-flow__edge[data-id="${CSS.escape(flowId)}"]`;
      document.querySelector<HTMLElement | SVGElement>(sel)?.focus({ preventScroll: true });
      done();
    },
    onBlur: () =>
      requestAnimationFrame(() => {
        if (document.activeElement?.getAttribute("data-name-field") !== flowId) done();
      }),
  };
  return { keys, merge: () => ({ merge: tag.current }) };
}

function NodePanel({
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
}: InspectorProps & { node: DiagramFlowNode }) {
  const stencil = getStencil(node.data.stencil);
  const role = stencil.simRole;
  const props = node.data.props ?? {};
  // A new node keeps its creation step while these name fields are focused.
  const [namingActive, setNamingActive] = useState(false);
  const naming = useNameFields(editor, "node", node.id, node.id, () => {
    setNamingActive(false);
    onNamed?.();
  });
  const nameKeys = {
    ...naming.keys,
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      setNamingActive(true);
      naming.keys.onFocus(e);
    },
  };
  const merge = (f: string) => ({ merge: `inspector:node:${node.id}:${f}` });
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [routingPinned, setRoutingPinned] = useState(false);
  const broker = brokerSpec(node.data.stencil, role, meta.planning);
  const simFields = nodeSimFields(role, node.data.stencil, meta.planning, props);
  const managed =
    (meta.planning?.revision === "p3" || meta.planning?.revision === "p3-a1") && !!managedKind(node.data.stencil);
  const device = role === "gateway" ? deviceSpec(node.data.stencil) : undefined;
  // What Custom properties leaves out: only the settings a control here shows.
  const hidden = !device ? SIM_KEYS : device.kind === "adc" ? ADC_KEYS : DEVICE_KEYS;
  // Request routing: a router's table and a source's mix get their own section once added (simple by default:
  // until then only an Add button inside Simulation).
  const router = routeTableCapable(node.data.stencil, role);
  const mixer = trafficMixCapable(role);
  // Each routing request (right-click, or the first route chosen into a mix) remounts the fields onto it.
  const intentSerial = useSyncExternalStore(routingIntent.subscribe, () => routingIntent.serial(node.id));
  const routing = router ? (
    <RouteTableFields key={intentSerial} editor={editor} nodeId={node.id} props={props} planning={meta.planning} />
  ) : mixer ? (
    <TrafficMixFields key={intentSerial} editor={editor} nodeId={node.id} props={props} planning={meta.planning} />
  ) : null;
  // A right-click "Add …" opens the section on its own; it stays there while this node is selected, so an
  // unfinished form never moves (and loses its fields) once the form has consumed the intent.
  const intended = (router || mixer) && routingIntent.peek(node.id) !== undefined;
  if (intended && !routingPinned) setRoutingPinned(true);
  const routed =
    (router && props.routeTable !== undefined) ||
    (mixer && props.trafficMix !== undefined) ||
    intended ||
    ((router || mixer) && routingPinned);

  return (
    <>
      <Section>
        <Field label={t("inspector.stencil")} group>
          <button
            className="insp-stencil"
            data-testid="inspector-field-stencil"
            aria-label={t("inspector.stencilValue", {
              stencil: stencilLabel(stencil),
              vendor: vendorLabel(stencil.vendor),
            })}
            aria-haspopup="menu"
            style={{ "--accent": stencil.accent } as CSSProperties}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPicker({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <span className="palette-tile">
              <StencilIcon stencil={stencil} size={18} />
            </span>
            <span className="insp-stencil-name">
              {stencilLabel(stencil)}
              <small>{vendorLabel(stencil.vendor)}</small>
            </span>
            <Icon name="chevron-down" size={14} />
          </button>
        </Field>
        <Field label={t("inspector.label")}>
          <input
            className="insp-input"
            value={node.data.label}
            onChange={(e) => editor.updateNode(node.id, { label: e.target.value }, naming.merge())}
            {...nameKeys}
            name="label"
            data-testid="inspector-field-label"
          />
        </Field>
        <Field label={t("inspector.subtitle")}>
          <input
            className="insp-input mono"
            value={node.data.sublabel ?? ""}
            placeholder={stencilLabel(stencil)}
            onChange={(e) => editor.updateNode(node.id, { sublabel: e.target.value }, naming.merge())}
            {...nameKeys}
            name="sublabel"
            data-testid="inspector-field-sublabel"
          />
        </Field>
        {connection && (
          <Field label={t("inspector.connection")}>
            <input
              className="insp-input"
              value={connection.label}
              placeholder={t("inspector.eGReserveStock")}
              onChange={(e) => editor.updateEdge(connection.id, { label: e.target.value || undefined }, naming.merge())}
              {...nameKeys}
              name="connection"
              data-testid="inspector-field-connection"
            />
          </Field>
        )}
        <Field label={t("inspector.boundary")}>
          <select
            className="insp-input"
            value={node.data.group ?? ""}
            onChange={(e) => editor.updateNode(node.id, { group: e.target.value || undefined })}
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
        <CopyId id={node.id} />
      </Section>

      {routed && (
        <Section title={router ? t("routing.tableHeading") : t("routing.mixHeading")}>
          <div data-testid="inspector-routing">{routing}</div>
        </Section>
      )}

      <NodePlanning
        id={node.id}
        editor={editor}
        revision={revision ?? node}
        readDiagram={readDiagram}
        paused={namingActive}
        counts={counts}
      />

      <Disclosure
        id="node-simulation"
        title={t("inspector.simulation")}
        aside={
          <span
            className="insp-role"
            style={{ "--role": simRoleMeta[role].hue } as CSSProperties}
            title={simRoleMeta[role].hint}
          >
            {simRoleMeta[role].label}
          </span>
        }
      >
        {broker?.partitioned === false && (
          <p className="insp-note" data-testid="broker-fanout">
            {assignmentLabel(broker)} · {t("broker.fanout")}
          </p>
        )}
        {managed ? (
          <AdmissionFields
            stencil={node.data.stencil}
            props={props}
            set={(patch, key) => editor.setNodeProps(node.id, patch, key ? merge(key) : undefined)}
            advanced={
              simFields.includes("emits") ? (
                <SimInput
                  name="emits"
                  field={SIM_FIELDS.emits!}
                  value={props.emits}
                  onChange={(value) =>
                    editor.setNodeProps(node.id, { emits: value as NodeSimProps["emits"] }, merge("emits"))
                  }
                />
              ) : undefined
            }
          />
        ) : device ? (
          <DeviceFields
            spec={device}
            props={props}
            set={(patch, key) => editor.setNodeProps(node.id, patch, key ? merge(key) : undefined)}
          />
        ) : simFields.length ? (
          <AutoscalingWorkload
            readDiagram={readDiagram}
            nodeId={node.id}
            stencil={node.data.stencil}
            enabled={meta.planning?.revision === "p3-a1" && role === "processor"}
            props={props}
            set={(patch, key) => editor.setNodeProps(node.id, patch, key ? merge(key) : undefined)}
          >
            {simFields.map((k) => (
              <SimInput
                key={k}
                name={k}
                field={
                  k === "partitions"
                    ? {
                        ...SIM_FIELDS[k]!,
                        label: assignmentLabel(broker),
                        hint: t("broker.assignmentHint"),
                        note:
                          meta.planning?.revision === "p2" ||
                          meta.planning?.revision === "p3" ||
                          meta.planning?.revision === "p3-a1"
                            ? undefined
                            : SIM_FIELDS[k]!.note,
                      }
                    : k === "replicas"
                      ? { ...SIM_FIELDS[k]!, hint: t("broker.replicaHint") }
                      : SIM_FIELDS[k]!
                }
                value={props[k]}
                onChange={(v) => editor.setNodeProps(node.id, { [k]: v }, merge(k))}
              />
            ))}
          </AutoscalingWorkload>
        ) : isClusterWrapper(node.data.stencil) ? (
          <p className="insp-note" data-testid="broker-wrapper">
            {t("broker.wrapper")}
          </p>
        ) : role === "sink" ? (
          <p className="insp-note" data-testid="inspector-sink-note">
            {t("inspector.messagesEndHereAsTheyArriveNothingHereChanges")}
          </p>
        ) : (
          <p className="insp-note">{t("inspector.thisStencilIsDecorativeAndDoesnTTakePart")}</p>
        )}
        {!routed && routing}
        {!router && props.routeTable !== undefined && (
          <InertNote
            name="routeTable"
            text={t("routing.dormantTable")}
            onRemove={() => editor.setNodeProps(node.id, { routeTable: undefined })}
          />
        )}
        {!mixer && props.trafficMix !== undefined && (
          <InertNote
            name="trafficMix"
            text={t("routing.dormantMix")}
            onRemove={() => editor.setNodeProps(node.id, { trafficMix: undefined })}
          />
        )}
        {(managed ? [] : inertNodeProps(role, props)).map(({ key, why }) => (
          <InertNote
            key={key}
            name={key}
            text={t("inspector.inertValue", {
              field: SIM_FIELDS[key]?.label ?? key,
              value: formatInert(props[key], SIM_FIELDS[key]?.unit),
              why,
            })}
            onRemove={() => editor.setNodeProps(node.id, { [key]: undefined })}
          />
        ))}
      </Disclosure>

      <Disclosure id="node-properties" title={t("inspector.customProperties")} count={customCount(props, hidden)}>
        <PropsEditor
          props={props}
          hidden={hidden}
          onSet={(patch) => editor.setNodeProps(node.id, patch)}
          onSetMerged={(patch, key) => editor.setNodeProps(node.id, patch, merge(`prop:${key}`))}
        />
      </Disclosure>

      {findings}

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

function EdgePanel({ edge, editor, nodeLabel, meta }: InspectorProps & { edge: DiagramFlowEdge }) {
  const naming = useNameFields(editor, "edge", edge.id, edge.id);
  const data = edge.data ?? { kind: "async" as const };
  const props = data.props ?? {};
  const merge = (f: string) => ({ merge: `inspector:edge:${edge.id}:${f}` });
  const relation = relationOf(data);
  const flow = relation === "flow";
  const fanOut = flow && isFanOut(editor, edge.source, data.kind);
  const choice = choiceOf(data);
  // A connection leaving a firewall is one of its rules: allow (the default) or deny.
  const rule = flow && isFirewallStencil(editor.getNode(edge.source)?.stencil);
  // Consumer groups exist only on edges out of a topic or stream; a dead-letter route only out of a broker.
  const sourceStencil = editor.getNode(edge.source)?.stencil;
  const sourceRole = sourceStencil ? getStencil(sourceStencil).simRole : undefined;
  const fields = edgeSimFields(sourceRole);
  const grouped = flow && fields.group && props.dlq !== true;
  const deadLetters = flow && fields.dlq;
  return (
    <>
      <Section>
        <div className="insp-route">
          <span>{nodeLabel(edge.source)}</span>
          <Icon name="chevron-right" size={12} />
          <span>{nodeLabel(edge.target)}</span>
          <button
            className="icon-btn insp-mini"
            onClick={() => editor.reverseEdge(edge.id)}
            title={t("inspector.reverseDirection")}
            aria-label={t("inspector.reverseDirection")}
            data-testid="inspector-reverse"
          >
            <Icon name="swap" size={14} />
          </button>
        </div>
        <Field label={t("inspector.label")}>
          <input
            className="insp-input"
            value={data.label ?? ""}
            placeholder={flow ? t("inspector.eGOrderplaced") : t("inspector.optionalEGKeyVaultSecretsUser")}
            onChange={(e) => editor.updateEdge(edge.id, { label: e.target.value }, naming.merge())}
            {...naming.keys}
            name="edge-label"
            data-testid="inspector-field-label"
          />
        </Field>
        <Field
          label={t("inspector.relationship")}
          hint={t("inspector.flowsCarryMessagesInLiveDependenciesAreDrawnDotted")}
        >
          <Dropdown
            value={choice}
            onChange={(nextId) => {
              const next = RELATION_CHOICES.find((c) => c.id === nextId);
              if (next) applyChoice(editor, [edge.id], next);
            }}
            items={relationDropdownItems()}
            name="relationship"
            aria-label={t("inspector.relationship")}
            testId="inspector-field-relation"
          />
        </Field>
        <RelationHint edge={edge} editor={editor} />
        {flow && (
          <EdgeRouteFields
            editor={editor}
            edgeId={edge.id}
            planning={meta.planning}
            caller={
              data.kind === "sync" && (sourceRole === "source" || sourceRole === "processor" || sourceRole === "none")
            }
          />
        )}
        {rule && (
          <Field
            label={t("inspector.firewallRule")}
            hint={t("inspector.denyBlocksWhatTheFirewallWouldSendHereBlocked")}
            group
          >
            <Segmented
              value={isDenyRule(props) ? "deny" : "allow"}
              options={[
                { value: "allow", label: t("inspector.allow"), hint: t("inspector.trafficPasses") },
                { value: "deny", label: t("inspector.deny"), hint: t("inspector.trafficIsBlockedAtTheFirewall") },
              ]}
              onChange={(v) => editor.setEdgeProps(edge.id, { deny: v === "deny" || undefined })}
              testId="inspector-field-rule"
              label={t("inspector.firewallRule")}
            />
          </Field>
        )}
        {grouped && (
          <Field
            label={groupLabel(brokerSpec(sourceStencil, sourceRole ?? "none", meta.planning))}
            hint={t("broker.groupHint")}
          >
            <input
              className="insp-input mono"
              value={typeof props.group === "string" ? props.group : ""}
              placeholder={edge.id}
              onChange={(e) => editor.setEdgeProps(edge.id, { group: e.target.value || undefined }, merge("group"))}
              name="consumer-group"
              data-testid="inspector-field-group"
            />
          </Field>
        )}
        {flow && !fields.group && typeof props.group === "string" && (
          <InertNote
            name="group"
            text={t("inspector.inertGroup", { group: String(props.group) })}
            onRemove={() => editor.setEdgeProps(edge.id, { group: undefined })}
          />
        )}
        {deadLetters && (
          <label className="insp-check">
            <input
              type="checkbox"
              checked={props.dlq === true}
              onChange={(e) => editor.setEdgeProps(edge.id, { dlq: e.target.checked || undefined })}
              name="dlq"
              data-testid="inspector-field-dlq"
            />
            <span>
              {t("inspector.deadLetterPath")}
              <small>{t("inspector.failedMessagesFromTheSourceBrokerGoHere")}</small>
            </span>
          </label>
        )}
        {flow && !deadLetters && props.dlq === true && (
          <InertNote
            name="dlq"
            text={
              sourceRole === "processor"
                ? t("inspector.deadLetterPathIsOnButOnlyABroker")
                : t("inspector.deadLetterPathIsOnButOnlyABroker2")
            }
            onRemove={() => editor.setEdgeProps(edge.id, { dlq: undefined })}
          />
        )}
        {!flow && (
          <p className="insp-note" data-testid="inspector-relation-note">
            {relationNote(relation)}
          </p>
        )}
      </Section>
      {relation === "config" && <SettingsEditor key={edge.id} edge={edge} editor={editor} />}
      {fanOut && (
        <Disclosure id="edge-simulation" title={t("inspector.simulation")}>
          <SimInput
            name="share"
            field={{
              label: t("inspector.shareOfMessages"),
              unit: "%",
              kind: "number",
              min: 0,
              max: 100,
              step: 5,
              placeholder: "100",
              hint: t("inspector.howManyOfTheMessagesLeavingThisNodeAlso"),
            }}
            value={typeof props.share === "number" ? Math.round(props.share * 1000) / 10 : undefined}
            onChange={(v) =>
              editor.setEdgeProps(edge.id, { share: typeof v === "number" ? v / 100 : undefined }, merge("share"))
            }
          />
        </Disclosure>
      )}
      <Disclosure id="edge-advanced" title={t("inspector.advanced")}>
        <div className="insp-row2">
          <Field label={t("inspector.fromSide")}>
            <SideSelect
              testId="inspector-field-sourceSide"
              value={data.sourceSide}
              onChange={(v) => editor.updateEdge(edge.id, { sourceSide: v })}
            />
          </Field>
          <Field label={t("inspector.toSide")}>
            <SideSelect
              testId="inspector-field-targetSide"
              value={data.targetSide}
              onChange={(v) => editor.updateEdge(edge.id, { targetSide: v })}
            />
          </Field>
        </div>
        {flow && (
          <>
            <SimInput
              name="travelMs"
              field={{
                label: t("inspector.travelTime"),
                unit: "ms",
                kind: "number",
                min: 0,
                max: SIM_LIMITS.timeMs,
                step: 50,
                placeholder: String(DEFAULT_TRAVEL_MS[data.kind === "sync" ? "sync" : "async"]),
                hint: t("inspector.timeAMessageSpendsOnThisEdgeAt1x"),
              }}
              value={props.travelMs}
              onChange={(v) => editor.setEdgeProps(edge.id, { travelMs: v }, merge("travelMs"))}
            />
            <SimInput
              name="filter"
              field={{
                label: t("inspector.filter"),
                kind: "list",
                placeholder: t("inspector.allMessageTypes"),
                hint: t("inspector.onlyTheseMessageTypesTravelThisEdgeTrailingWildcard"),
              }}
              value={props.filter}
              onChange={(v) => editor.setEdgeProps(edge.id, { filter: v }, merge("filter"))}
            />
            <SimInput
              name="emits"
              field={{
                label: t("inspector.renameTo"),
                kind: "text",
                placeholder: t("inspector.unchanged"),
                hint: t("inspector.renameMessagesAsTheyLeaveAlongThisEdge"),
              }}
              value={props.emits}
              onChange={(v) => editor.setEdgeProps(edge.id, { emits: v }, merge("emits"))}
            />
          </>
        )}
        <span className="insp-label">{t("inspector.customProperties")}</span>
        <PropsEditor
          props={props}
          hidden={rule ? RULE_KEYS : EDGE_KEYS}
          onSet={(patch) => editor.setEdgeProps(edge.id, patch)}
          onSetMerged={(patch, key) => editor.setEdgeProps(edge.id, patch, merge(`prop:${key}`))}
        />
      </Disclosure>
    </>
  );
}

/** Flow edges into a typed stencil (Key Vault, an IdP...): offer the dependency they look like. */
const dismissedHints = new Set<string>();
function RelationHint({ edge, editor }: { edge: DiagramFlowEdge; editor: EditorApi }) {
  const [, rerender] = useState(0);
  if (isDependency(edge.data) || dismissedHints.has(edge.id)) return null;
  const want = inferRelation(editor.getNode(edge.source)?.stencil, editor.getNode(edge.target)?.stencil);
  if (want === "flow") return null;
  return (
    <div className="insp-hint" data-testid="inspector-relation-hint">
      <Icon name={relationIcon(want)} size={13} />
      <span>{t("inspector.suggestRelation", { relation: relationLabel[want].toLocaleLowerCase() })}</span>
      <button
        type="button"
        className="insp-link"
        onClick={() => editor.updateEdge(edge.id, { relation: want })}
        data-testid="inspector-relation-hint-apply"
      >
        {t("inspector.apply")}
      </button>
      <button
        type="button"
        className="icon-btn insp-mini"
        title={t("inspector.keepItAFlow")}
        aria-label={t("inspector.keepItAFlow")}
        onClick={() => {
          dismissedHints.add(edge.id);
          rerender((n) => n + 1);
        }}
        data-testid="inspector-relation-hint-dismiss"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/**
 * The settings a service reads over a config edge: one key per line, `!` before a secret (a Key Vault
 * reference). Pasting appsettings.json, `az appconfig kv list` or .env output just works. Each key can
 * also be locked or unlocked from the list.
 */
function SettingsEditor({ edge, editor }: { edge: DiagramFlowEdge; editor: EditorApi }) {
  const settings = edgeSettings(edge.data);
  const committed = settingsText(settings);
  const [draft, setDraft] = useState(committed);
  const [error, setError] = useState<string>();
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    // Undo, a lock toggle or a paste elsewhere changed them: show the new list unless it's what we typed.
    setSeen(committed);
    if (settingsText(parseSettingsEditor(draft)) !== committed) setDraft(committed);
  }
  const save = (next: ConfigSetting[], mergeTag?: string) =>
    editor.setEdgeProps(
      edge.id,
      { settings: next.length ? next : undefined },
      mergeTag ? { merge: mergeTag } : undefined,
    );
  const summary = settingsSummary(settings);
  return (
    <Section
      title={t("inspector.settings")}
      aside={summary ? <span className="insp-count">{summary}</span> : undefined}
    >
      <textarea
        className="insp-input mono insp-settings"
        rows={Math.min(8, Math.max(3, settings.length + 1))}
        value={draft}
        // eslint-disable-next-line local/no-literal-ui-text -- example configuration keys retain their bytes
        placeholder={"Orders:PageSize\n!ConnectionStrings:Orders"}
        onChange={(e) => {
          setError(undefined);
          setDraft(e.target.value);
          save(parseSettingsEditor(e.target.value), `inspector:edge:${edge.id}:settings`);
        }}
        maxLength={MAX_SETTINGS_TEXT}
        onPaste={(e) => {
          e.preventDefault();
          try {
            const imported = settingsText(parseSettings(e.clipboardData.getData("text/plain")));
            const field = e.currentTarget;
            const nextText = draft.slice(0, field.selectionStart) + imported + draft.slice(field.selectionEnd);
            if (nextText.length > MAX_SETTINGS_TEXT) throw new Error(t("inspector.settingsPasteIsTooLarge"));
            const next = parseSettingsEditor(nextText);
            setError(undefined);
            setDraft(settingsText(next));
            save(next, `inspector:edge:${edge.id}:settings`);
          } catch (err) {
            setError(err instanceof Error ? err.message : t("inspector.couldNotImportSettings"));
          }
        }}
        aria-invalid={!!error}
        aria-describedby={error ? "settings-paste-error" : undefined}
        spellCheck={false}
        aria-label={t("inspector.settingsReadOverThisEdgeOnePerLineMarks")}
        name="settings"
        data-testid="inspector-field-settings"
      />
      {error && (
        <p role="alert" id="settings-paste-error" data-testid="inspector-settings-error" className="insp-note">
          {error}
        </p>
      )}
      <p className="insp-note">{t("inspector.oneKeyPerLineMarksASecretAKey")}</p>
      {settings.length > 0 && (
        <ul className="insp-settings-list" data-testid="inspector-settings-list">
          {settings.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                className={`icon-btn insp-mini insp-lock${s.secret ? " is-on" : ""}`}
                aria-pressed={!!s.secret}
                aria-label={t("inspector.secretKey", { key: s.key })}
                title={
                  s.secret
                    ? t("inspector.secretAKeyVaultReferenceClickForAPlain")
                    : t("inspector.plainValueClickToMarkSecret")
                }
                onClick={() => {
                  const next = settings.map((x, j) =>
                    j === i ? (x.secret ? { key: x.key } : { key: x.key, secret: true }) : x,
                  );
                  setDraft(settingsText(next));
                  save(next);
                }}
                data-testid={`inspector-setting-lock-${i}`}
              >
                <Icon name={s.secret ? "lock" : "lock-open"} size={12} />
              </button>
              <span className="mono">{s.key}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
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

const showValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  if (/^(true|false|null|-?\d+(\.\d+)?|\[.*\]|\{.*\})$/s.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return raw;
    }
  }
  return raw;
}

function PropValue({ name, value, onChange }: { name: string; value: unknown; onChange: (raw: string) => void }) {
  const external = showValue(value);
  const [draft, setDraft] = useState(external);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(external);
  }, [external]);
  return (
    <input
      className="insp-input mono"
      value={draft}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setDraft(external);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      aria-label={t("inspector.propertyValue", { name })}
      name={`prop-${name}`}
      data-testid={`inspector-prop-${name}`}
    />
  );
}

/** Free-form key / value props (anything that isn't a known field). */
function PropsEditor({
  props,
  hidden,
  onSet,
  onSetMerged,
}: {
  props: Record<string, unknown>;
  hidden: Set<string>;
  onSet: (patch: Record<string, unknown>) => void;
  onSetMerged: (patch: Record<string, unknown>, key: string) => void;
}) {
  const entries = Object.entries(props).filter(([k]) => !hidden.has(k));
  const [newKey, setNewKey] = useState("");
  const add = () => {
    const k = newKey.trim();
    if (!k || k in props) return;
    onSet({ [k]: "" });
    setNewKey("");
  };
  return (
    <div className="insp-props" data-testid="inspector-props">
      {entries.map(([k, v]) => (
        <div key={k} className="insp-prop">
          <span className="insp-prop-key mono" title={k}>
            {k}
          </span>
          <PropValue name={k} value={v} onChange={(raw) => onSetMerged({ [k]: parseValue(raw) }, k)} />
          <button
            className="icon-btn insp-mini"
            onClick={() => onSet({ [k]: undefined })}
            title={t("inspector.removeProperty", { name: k })}
            aria-label={t("inspector.removeProperty", { name: k })}
            data-testid={`inspector-prop-remove-${k}`}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <div className="insp-prop insp-prop-new">
        <input
          className="insp-input mono"
          value={newKey}
          placeholder={t("inspector.addProperty")}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label={t("inspector.newPropertyName")}
          name="new-prop"
          data-testid="inspector-prop-new"
        />
        <button
          className="icon-btn insp-mini"
          onClick={add}
          disabled={!newKey.trim()}
          title={t("inspector.addProperty2")}
          aria-label={t("inspector.addProperty2")}
          data-testid="inspector-prop-add"
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
    </div>
  );
}

export type { InspectorProps } from "./inspector/types";
