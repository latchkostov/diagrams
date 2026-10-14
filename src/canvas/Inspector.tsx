import { ANNOTATION_LIMITS } from "../model/annotations";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type FocusEvent,
  type ReactNode,
} from "react";
import { getStencil } from "../stencils/registry";
import { simRoleMeta } from "../lib/simRoles";
import type { NodeSimProps } from "../sim/types";
import type { DiagramFile, Side, SimRole } from "../model/types";
import { Icon, type IconName } from "../components/Icon";
import { StencilIcon } from "../components/StencilIcon";
import { ContextMenu } from "../components/ContextMenu";
import { stencilMenu } from "../editor/builtinActions";
import type { EditorApi } from "../editor/types";
import type { AlignMode } from "../editor/arrange";
import { parseEmits } from "../editor/emits";
import type { DiagramMeta } from "./convert";
import { toneColor, toneLabel } from "./groupTones";
import type { AnnotationFlowNode, DiagramFlowEdge, DiagramFlowNode, GroupFlowNode, GroupTone } from "./types";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_IDS,
  ANNOTATION_SHAPES,
  ANNOTATION_TEXT_SIZES,
  annotationColor,
  defaultColor,
  resolveAnnotationColor,
  kindLabel,
  minSize,
  shapeLabel,
  textSizeLabel,
} from "./annotations";
import { ColorPickerModal } from "../components/ColorPickerModal";
import { safeStorage } from "../lib/storage";
import {
  RELATION_META,
  edgeSettings,
  isDependency,
  parseSettings,
  parseSettingsEditor,
  MAX_SETTINGS_TEXT,
  relationNote,
  relationOf,
  settingsSummary,
  settingsText,
  type ConfigSetting,
} from "../model/relations";
import { RELATION_CHOICES, applyChoice, choiceOf, relationIcon } from "../editor/relationActions";
import { inferRelation } from "../stencils/relations";
import {
  DEFAULT_FAILOVER_MS,
  DEFAULT_MESSAGE_KB,
  presetOf,
  sizeOf,
  sizesOf,
  HA_LABEL,
  SIZE_LABEL,
  deviceSpec,
  isDeviceHa,
  isDenyRule,
  isFirewallStencil,
  messagesPerSec,
  type DeviceHa,
  type DeviceSize,
  type DeviceSpec,
} from "../stencils/netDevices";
import { formatCount } from "../live/format";
import { DEFAULT_TRAVEL_MS } from "../sim/topology";
import { nodeSimFields, edgeSimFields, inertNodeProps } from "./simFieldRules";
import { SIM_LIMITS } from "../interop/native";
import { t } from "../i18n";
import { brokerSpec, isClusterWrapper } from "../model/brokers";
import { assignmentLabel, groupLabel } from "../stencils/brokerVocabulary";
import { NodePlanning, PlanningUpgrade } from "../planning/lazy";

// Right-hand properties panel. Every edit goes through EditorApi (so it is undoable); typing
// is coalesced per field via the `merge` option.

type SimKey = keyof NodeSimProps;

interface SimField {
  label: string;
  unit?: string;
  /** "map": one type, or `In → Out, In2 → Out2` (or JSON) for a map. "list": comma-separated strings. */
  kind: "number" | "text" | "map" | "list";
  min?: number;
  max?: number;
  step?: number;
  placeholder: string;
  hint: string;
  /** A line shown under the field, for what people get wrong about it. */
  note?: string;
}

// Partial on purpose: engine knobs without a designed field yet stay editable under "Custom properties". Bounds are
// the file format's (SIM_LIMITS): a value the inspector takes always saves and opens again.
const SIM_FIELDS: Partial<Record<SimKey, SimField>> = {
  ratePerSec: {
    label: "Rate",
    unit: "msg/s",
    kind: "number",
    min: 0,
    max: SIM_LIMITS.ratePerSec,
    step: 0.5,
    placeholder: "2",
    hint: "Messages per second while traffic is on",
  },
  messageType: {
    label: "Message type",
    kind: "text",
    placeholder: "derived from label",
    hint: "Type emitted by this source",
  },
  latencyMs: {
    label: "Latency",
    unit: "ms",
    kind: "number",
    min: 0,
    max: SIM_LIMITS.timeMs,
    step: 10,
    placeholder: "default",
    hint: "Processing time per message",
  },
  concurrency: {
    label: "Concurrency",
    kind: "number",
    min: 1,
    max: SIM_LIMITS.count,
    step: 1,
    placeholder: "4",
    hint: "Messages processed in parallel per replica",
  },
  replicas: {
    label: "Replicas",
    kind: "number",
    min: 1,
    max: SIM_LIMITS.count,
    step: 1,
    placeholder: "1",
    hint: "",
  },
  jitter: {
    label: "Latency jitter",
    unit: "0–1",
    kind: "number",
    min: 0,
    max: 1,
    step: 0.05,
    placeholder: "0.2",
    hint: "Random spread on latency (0.2 = ±20%)",
  },
  failureRate: {
    label: "Failure rate",
    unit: "0–1",
    kind: "number",
    min: 0,
    max: 1,
    step: 0.05,
    placeholder: "0",
    hint: "Probability a message fails processing",
  },
  maxDeliveryCount: {
    label: "Max deliveries",
    kind: "number",
    min: 1,
    max: SIM_LIMITS.count,
    step: 1,
    placeholder: "3",
    hint: "Attempts before dead-lettering",
  },
  partitions: {
    label: "Partitions",
    kind: "number",
    min: 1,
    max: SIM_LIMITS.count,
    step: 1,
    placeholder: "3",
    hint: "Max in-flight deliveries per consumer group",
    note: "How many consumers in one group can work in parallel. It doesn't speed up publishing.",
  },
  emits: {
    label: "Emits",
    kind: "map",
    placeholder: "unchanged, or In → Out, * → Other",
    hint: "Message type sent downstream. One name renames everything; `OrderPlaced → PaymentRequested, * → Other` maps by incoming type (* = fallback).",
  },
};

const SIM_KEYS = new Set<string>(Object.keys(SIM_FIELDS));
// A setting leaves Custom properties only where a control for it shows: a device's own section, a firewall's rule.
// Anywhere else (an nginx with a `gbps`, a service's connection with `deny`) it stays there, to see, change or remove.
const DEVICE_KEYS = new Set<string>([...SIM_KEYS, "size", "gbps", "messageKB", "ha", "failoverMs"]);
const ADC_KEYS = new Set<string>([...DEVICE_KEYS, "healthChecks"]);
const EDGE_KEYS = new Set(["group", "dlq", "travelMs", "filter", "emits", "share", "settings"]);
const RULE_KEYS = new Set([...EDGE_KEYS, "deny"]);
const SIDES: Side[] = ["top", "right", "bottom", "left"];

export interface InspectorProps {
  editor: EditorApi;
  meta: DiagramMeta;
  selectedNodes: DiagramFlowNode[];
  selectedGroups: GroupFlowNode[];
  selectedEdges: DiagramFlowEdge[];
  /** Selected texts, notes, zones and shapes. */
  selectedAnnotations?: AnnotationFlowNode[];
  groups: GroupFlowNode[];
  nodeLabel: (id: string) => string;
  counts: { nodes: number; edges: number; groups: number };
  collapsed: boolean;
  onToggle: () => void;
  /**
   * Focus request: `inspector-field-<name>`, its text all selected (`caret: "end"`: the caret after it, for a name
   * typed before the field could take it); `seq` re-triggers for the same name.
   */
  focus?: { name: string; seq: number; caret?: "end"; target?: string };
  /** Request consumption survives inspector unmounts (presentation). */
  takeFocus?: (seq: number) => boolean;
  /**
   * A node just made connected, while it's being named: its connection's label, one Tab after the Subtitle
   * (`onNamed`: the naming is done, so the field goes).
   */
  connection?: { id: string; label: string };
  onNamed?: () => void;
  /** The selection's architecture-check findings. Nodes show them after their configuration. */
  findings?: ReactNode;
  /** Canvas revision, read by planning only outside a name edit. */
  revision?: unknown;
  /** Reads the canvas's current render, before React Flow's imperative store catches up. */
  readDiagram?: () => DiagramFile;
  /** A text's edit is done (see DiagramUi.settleText): it moves clear if it grew over something. */
  onTextSettled?: (id: string, before: { x: number; y: number; width: number; height: number }) => void;
}

export function Inspector(p: InspectorProps) {
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
      <aside className="inspector is-collapsed" data-testid="inspector" data-collapsed="1" aria-label="Inspector">
        <button
          className="icon-btn"
          onClick={p.onToggle}
          title="Show inspector"
          aria-label="Show inspector"
          data-testid="inspector-toggle"
        >
          <Icon name="panel-right" />
        </button>
      </aside>
    );
  }

  const annotations = p.selectedAnnotations ?? [];
  const n = p.selectedNodes.length + p.selectedGroups.length + p.selectedEdges.length + annotations.length;
  let title = "Diagram";
  let content: ReactNode;
  if (n === 0) content = <DiagramPanel {...p} />;
  else if (n === 1 && p.selectedNodes[0]) {
    title = "Node";
    content = <NodePanel key={p.selectedNodes[0].id} node={p.selectedNodes[0]} {...p} />;
  } else if (n === 1 && p.selectedEdges[0]) {
    title = "Edge";
    content = <EdgePanel key={p.selectedEdges[0].id} edge={p.selectedEdges[0]} {...p} />;
  } else if (n === 1 && annotations[0]) {
    title = kindLabel[annotations[0].data.kind];
    content = <AnnotationPanel key={annotations[0].id} note={annotations[0]} {...p} />;
  } else if (n === 1 && p.selectedGroups[0]) {
    title = "Boundary";
    content = <GroupPanel key={p.selectedGroups[0].id} group={p.selectedGroups[0]} {...p} />;
  } else {
    title = `${n} selected`;
    content = <MultiPanel {...p} />;
  }

  return (
    <aside
      className="inspector"
      data-testid="inspector"
      aria-label="Inspector"
      data-inspector-mode={title.toLowerCase()}
    >
      <div className="insp-head">
        <span className="insp-title" data-testid="inspector-title">
          {title}
        </span>
        <button
          className="icon-btn"
          onClick={p.onToggle}
          title="Hide inspector"
          aria-label="Hide inspector"
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
  const broker = brokerSpec(node.data.stencil, role, meta.planning);
  const simFields = nodeSimFields(role, node.data.stencil, meta.planning);
  const device = role === "gateway" ? deviceSpec(node.data.stencil) : undefined;
  // What Custom properties leaves out: only the settings a control here shows.
  const hidden = !device ? SIM_KEYS : device.kind === "adc" ? ADC_KEYS : DEVICE_KEYS;

  return (
    <>
      <Section>
        <Field label="Stencil" group>
          <button
            className="insp-stencil"
            data-testid="inspector-field-stencil"
            aria-label={`Stencil: ${stencil.label} (${stencil.vendor}). Change stencil`}
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
              {stencil.label}
              <small>{stencil.vendor}</small>
            </span>
            <Icon name="chevron-down" size={14} />
          </button>
        </Field>
        <Field label="Label">
          <input
            className="insp-input"
            value={node.data.label}
            onChange={(e) => editor.updateNode(node.id, { label: e.target.value }, naming.merge())}
            {...nameKeys}
            name="label"
            data-testid="inspector-field-label"
          />
        </Field>
        <Field label="Subtitle">
          <input
            className="insp-input mono"
            value={node.data.sublabel ?? ""}
            placeholder={stencil.label}
            onChange={(e) => editor.updateNode(node.id, { sublabel: e.target.value }, naming.merge())}
            {...nameKeys}
            name="sublabel"
            data-testid="inspector-field-sublabel"
          />
        </Field>
        {connection && (
          <Field label="Connection">
            <input
              className="insp-input"
              value={connection.label}
              placeholder="e.g. Reserve stock"
              onChange={(e) => editor.updateEdge(connection.id, { label: e.target.value || undefined }, naming.merge())}
              {...nameKeys}
              name="connection"
              data-testid="inspector-field-connection"
            />
          </Field>
        )}
        <Field label="Boundary">
          <select
            className="insp-input"
            value={node.data.group ?? ""}
            onChange={(e) => editor.updateNode(node.id, { group: e.target.value || undefined })}
            name="group"
            data-testid="inspector-field-group"
          >
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.data.groupId}>
                {g.data.label}
              </option>
            ))}
          </select>
        </Field>
        <CopyId id={node.id} />
      </Section>

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
        title="Simulation"
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
        {device ? (
          <DeviceFields
            spec={device}
            props={props}
            set={(patch, key) => editor.setNodeProps(node.id, patch, key ? merge(key) : undefined)}
          />
        ) : simFields.length ? (
          simFields.map((k) => (
            <SimInput
              key={k}
              name={k}
              field={
                k === "partitions"
                  ? {
                      ...SIM_FIELDS[k]!,
                      label: assignmentLabel(broker),
                      hint: t("broker.assignmentHint"),
                      note: meta.planning?.revision === "p2" ? undefined : SIM_FIELDS[k]!.note,
                    }
                  : k === "replicas"
                    ? { ...SIM_FIELDS[k]!, hint: t("broker.replicaHint") }
                    : SIM_FIELDS[k]!
              }
              value={props[k]}
              onChange={(v) => editor.setNodeProps(node.id, { [k]: v }, merge(k))}
            />
          ))
        ) : isClusterWrapper(node.data.stencil) ? (
          <p className="insp-note" data-testid="broker-wrapper">
            {t("broker.wrapper")}
          </p>
        ) : role === "sink" ? (
          <p className="insp-note" data-testid="inspector-sink-note">
            Messages end here as they arrive: nothing here changes the run.
          </p>
        ) : (
          <p className="insp-note">This stencil is decorative and doesn't take part in the simulation.</p>
        )}
        {inertNodeProps(role, props).map(({ key, why }) => (
          <InertNote
            key={key}
            name={key}
            text={`${SIM_FIELDS[key]?.label ?? key} ${formatInert(props[key], SIM_FIELDS[key]?.unit)} is kept in the file, but ${why}, so it doesn't change the run.`}
            onRemove={() => editor.setNodeProps(node.id, { [key]: undefined })}
          />
        ))}
      </Disclosure>

      <Disclosure id="node-properties" title="Custom properties" count={customCount(props, hidden)}>
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
          label="Change stencil"
          testId="stencil-picker"
          searchable="Search stencils"
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
            title="Reverse direction"
            aria-label="Reverse direction"
            data-testid="inspector-reverse"
          >
            <Icon name="swap" size={14} />
          </button>
        </div>
        <Field label="Label">
          <input
            className="insp-input"
            value={data.label ?? ""}
            placeholder={flow ? "e.g. OrderPlaced" : "Optional, e.g. Key Vault Secrets User"}
            onChange={(e) => editor.updateEdge(edge.id, { label: e.target.value }, naming.merge())}
            {...naming.keys}
            name="edge-label"
            data-testid="inspector-field-label"
          />
        </Field>
        <Field label="Relationship" hint="Flows carry messages in Live; dependencies are drawn dotted and carry none">
          <span className={`insp-relation${flow ? "" : ` fe-rel-${relation}`}`}>
            <Icon name={relationIcon(relation, data.kind)} size={14} />
            <select
              className="insp-input"
              value={choice}
              onChange={(e) => {
                const next = RELATION_CHOICES.find((c) => c.id === e.target.value);
                if (next) applyChoice(editor, [edge.id], next);
              }}
              name="relationship"
              data-testid="inspector-field-relation"
            >
              <optgroup label="Flow">
                {RELATION_CHOICES.filter((c) => c.relation === "flow").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.kind})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Dependency">
                {RELATION_CHOICES.filter((c) => c.relation !== "flow").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </span>
        </Field>
        <RelationHint edge={edge} editor={editor} />
        {rule && (
          <Field
            label="Firewall rule"
            hint="Deny blocks what the firewall would send here. Blocked messages are on purpose: they never count as lost"
            group
          >
            <Segmented
              value={isDenyRule(props) ? "deny" : "allow"}
              options={[
                { value: "allow", label: "Allow", hint: "Traffic passes" },
                { value: "deny", label: "Deny", hint: "Traffic is blocked at the firewall" },
              ]}
              onChange={(v) => editor.setEdgeProps(edge.id, { deny: v === "deny" || undefined })}
              testId="inspector-field-rule"
              label="Firewall rule"
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
            text={`Consumer group “${props.group}” is kept in the file, but only edges out of a topic or stream have groups, so it doesn't change the run.`}
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
              Dead-letter path
              <small>Failed messages from the source broker go here</small>
            </span>
          </label>
        )}
        {flow && !deadLetters && props.dlq === true && (
          <InertNote
            name="dlq"
            text={
              sourceRole === "processor"
                ? "Dead-letter path is on, but only a broker's dead-letter route catches failed messages: this edge carries nothing in Live."
                : "Dead-letter path is on, but only a broker's dead-letter route catches failed messages, so it doesn't change the run."
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
        <Disclosure id="edge-simulation" title="Simulation">
          <SimInput
            name="share"
            field={{
              label: "Share of messages",
              unit: "%",
              kind: "number",
              min: 0,
              max: 100,
              step: 5,
              placeholder: "100",
              hint: "How many of the messages leaving this node also take this edge. Each edge decides on its own, so two edges at 80% can both get a message.",
            }}
            value={typeof props.share === "number" ? Math.round(props.share * 1000) / 10 : undefined}
            onChange={(v) =>
              editor.setEdgeProps(edge.id, { share: typeof v === "number" ? v / 100 : undefined }, merge("share"))
            }
          />
        </Disclosure>
      )}
      <Disclosure id="edge-advanced" title="Advanced">
        <div className="insp-row2">
          <Field label="From side">
            <SideSelect
              testId="inspector-field-sourceSide"
              value={data.sourceSide}
              onChange={(v) => editor.updateEdge(edge.id, { sourceSide: v })}
            />
          </Field>
          <Field label="To side">
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
                label: "Travel time",
                unit: "ms",
                kind: "number",
                min: 0,
                max: SIM_LIMITS.timeMs,
                step: 50,
                placeholder: String(DEFAULT_TRAVEL_MS[data.kind === "sync" ? "sync" : "async"]),
                hint: "Time a message spends on this edge at 1x",
              }}
              value={props.travelMs}
              onChange={(v) => editor.setEdgeProps(edge.id, { travelMs: v }, merge("travelMs"))}
            />
            <SimInput
              name="filter"
              field={{
                label: "Filter",
                kind: "list",
                placeholder: "all message types",
                hint: 'Only these message types travel this edge; trailing * wildcard, e.g. "Order*"',
              }}
              value={props.filter}
              onChange={(v) => editor.setEdgeProps(edge.id, { filter: v }, merge("filter"))}
            />
            <SimInput
              name="emits"
              field={{
                label: "Rename to",
                kind: "text",
                placeholder: "unchanged",
                hint: "Rename messages as they leave along this edge",
              }}
              value={props.emits}
              onChange={(v) => editor.setEdgeProps(edge.id, { emits: v }, merge("emits"))}
            />
          </>
        )}
        <span className="insp-label">Custom properties</span>
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

/** A value kept in the file that can't change the run where it is: said in a muted line, with a way to remove it. */
function InertNote({ name, text, onRemove }: { name: string; text: string; onRemove: () => void }) {
  return (
    <p className="insp-note insp-inert" data-testid={`inspector-inert-${name}`}>
      {text}{" "}
      <button
        type="button"
        className="insp-link"
        onClick={(event) => {
          // Removing the note removes this button too. Keep keyboard focus in its surviving section.
          if (document.activeElement === event.currentTarget) {
            const section = event.currentTarget.closest("section");
            const target =
              section?.querySelector<HTMLElement>("button[aria-expanded]") ??
              section?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)");
            target?.focus();
          }
          onRemove();
        }}
        data-testid={`inspector-inert-${name}-remove`}
      >
        Remove
      </button>
    </p>
  );
}

/** "8", "500 ms", or the JSON of anything else. */
function formatInert(value: unknown, unit?: string): string {
  const text = typeof value === "number" || typeof value === "string" ? String(value) : JSON.stringify(value);
  return unit && typeof value === "number" ? `${text} ${unit}` : text;
}

/** Flow edges into a typed stencil (Key Vault, an IdP...): offer the dependency they look like. */
const dismissedHints = new Set<string>();
function RelationHint({ edge, editor }: { edge: DiagramFlowEdge; editor: EditorApi }) {
  const [, rerender] = useState(0);
  if (isDependency(edge.data) || dismissedHints.has(edge.id)) return null;
  const want = inferRelation(editor.getNode(edge.source)?.stencil, editor.getNode(edge.target)?.stencil);
  if (want === "flow") return null;
  const meta = RELATION_META[want];
  return (
    <div className="insp-hint" data-testid="inspector-relation-hint">
      <Icon name={relationIcon(want)} size={13} />
      <span>Looks like a {meta.label.toLowerCase()} dependency, not a flow.</span>
      <button
        type="button"
        className="insp-link"
        onClick={() => editor.updateEdge(edge.id, { relation: want })}
        data-testid="inspector-relation-hint-apply"
      >
        Apply
      </button>
      <button
        type="button"
        className="icon-btn insp-mini"
        title="Keep it a flow"
        aria-label="Keep it a flow"
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
    <Section title="Settings" aside={summary ? <span className="insp-count">{summary}</span> : undefined}>
      <textarea
        className="insp-input mono insp-settings"
        rows={Math.min(8, Math.max(3, settings.length + 1))}
        value={draft}
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
            if (nextText.length > MAX_SETTINGS_TEXT) throw new Error("Settings paste is too large.");
            const next = parseSettingsEditor(nextText);
            setError(undefined);
            setDraft(settingsText(next));
            save(next, `inspector:edge:${edge.id}:settings`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not import settings.");
          }
        }}
        aria-invalid={!!error}
        aria-describedby={error ? "settings-paste-error" : undefined}
        spellCheck={false}
        aria-label="Settings read over this edge, one per line; ! marks a secret"
        name="settings"
        data-testid="inspector-field-settings"
      />
      {error && (
        <p role="alert" id="settings-paste-error" data-testid="inspector-settings-error" className="insp-note">
          {error}
        </p>
      )}
      <p className="insp-note">
        One key per line; ! marks a secret (a Key Vault reference). Pasting appsettings.json works too.
      </p>
      {settings.length > 0 && (
        <ul className="insp-settings-list" data-testid="inspector-settings-list">
          {settings.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                className={`icon-btn insp-mini insp-lock${s.secret ? " is-on" : ""}`}
                aria-pressed={!!s.secret}
                aria-label={`Secret: ${s.key}`}
                title={
                  s.secret
                    ? "Secret (a Key Vault reference): click for a plain value"
                    : "Plain value: click to mark secret"
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

/** Edges whose source copies each message to every route (sources, services, change feeds): they take a share. */
const FAN_OUT_ROLES: ReadonlySet<SimRole> = new Set(["source", "processor", "none"]);
function isFanOut(editor: EditorApi, sourceId: string, kind: string | undefined): boolean {
  const node = editor.getNode(sourceId);
  if (!node) return false;
  const role = getStencil(node.stencil).simRole;
  return FAN_OUT_ROLES.has(role) || (role === "store" && kind !== "sync");
}

function GroupPanel({ group, editor }: InspectorProps & { group: GroupFlowNode }) {
  const naming = useNameFields(editor, "group", group.data.groupId, group.id);
  const id = group.data.groupId;
  return (
    <Section>
      <Field label="Label">
        <input
          className="insp-input"
          value={group.data.label}
          onChange={(e) => editor.updateGroup(id, { label: e.target.value }, naming.merge())}
          {...naming.keys}
          name="group-label"
          data-testid="inspector-field-label"
        />
      </Field>
      <Field label="Colour" group>
        <div className="insp-tones" data-testid="inspector-field-tone" role="radiogroup" aria-label="Colour">
          {(Object.keys(toneColor) as GroupTone[]).map((t) => (
            <button
              key={t}
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
        </div>
      </Field>
      <div className="insp-actions">
        <button className="btn" onClick={() => editor.fitGroupToContents(id)} data-testid="inspector-group-fit">
          <Icon name="fit" size={14} /> Fit to contents
        </button>
        <button className="btn" onClick={() => editor.ungroup(id)} data-testid="inspector-group-ungroup">
          <Icon name="ungroup" size={14} /> Remove boundary
        </button>
      </div>
    </Section>
  );
}

function AnnotationPanel({ note, editor, onTextSettled }: InspectorProps & { note: AnnotationFlowNode }) {
  const id = note.id;
  const { kind } = note.data;
  const merge = (f: string) => ({ merge: `inspector:annotation:${id}:${f}` });
  const color = annotationColor(note.data);
  const resolved = resolveAnnotationColor(note.data.color, kind);
  const isCustomColor = !resolved.isPreset;
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
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
      <Field label={kind === "zone" ? "Label" : "Text"}>
        <textarea
          className="insp-input"
          rows={kind === "zone" ? 1 : 3}
          value={note.data.text}
          placeholder={kind === "zone" ? "Zone name" : "Write something"}
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
      </Field>
      {kind === "shape" && (
        <Field label="Shape" group>
          <div className="insp-toolbar" role="radiogroup" aria-label="Shape" data-testid="inspector-field-shape">
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
      <Field label="Colour" group>
        <div className="insp-tones" data-testid="inspector-field-color" role="radiogroup" aria-label="Colour">
          {ANNOTATION_COLOR_IDS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              className={`insp-tone${color === c ? " is-on" : ""}`}
              style={{ "--tone": ANNOTATION_COLORS[c].hex } as CSSProperties}
              title={ANNOTATION_COLORS[c].label}
              aria-label={ANNOTATION_COLORS[c].label}
              data-color={c}
              onClick={() => editor.updateAnnotation(id, { color: c })}
              data-testid={`inspector-color-${c}`}
            />
          ))}
          <button
            type="button"
            className={`insp-tone-custom${isCustomColor ? " is-on" : ""}`}
            title="Custom colour"
            aria-label="Custom colour"
            aria-haspopup="dialog"
            onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}
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
          currentColor={resolved.hex}
          defaultColor={ANNOTATION_COLORS[defaultColor[kind]].hex}
          anchorRect={pickerAnchor}
          onSelect={(hex) => editor.updateAnnotation(id, { color: hex })}
          onClose={() => setPickerAnchor(null)}
        />
      )}
      {/* A zone's label is a label, like a boundary's: one size. */}
      {kind !== "zone" && (
        <Field label="Text size" group>
          <Segmented
            testId="inspector-field-text-size"
            label="Text size"
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
        <Field label="Size" group>
          <div className="insp-size">
            <SizeInput
              label="Width"
              value={note.width ?? note.measured?.width ?? 0}
              min={min.width}
              testId="inspector-field-width"
              onCommit={(width) => editor.updateAnnotation(id, { width })}
            />
            <span aria-hidden>{"×"}</span>
            <SizeInput
              label="Height"
              value={note.height ?? note.measured?.height ?? 0}
              min={min.height}
              testId="inspector-field-height"
              onCommit={(height) => editor.updateAnnotation(id, { height })}
            />
          </div>
        </Field>
      )}
      <p className="insp-note">
        {kind === "zone"
          ? "A zone only marks an area: nodes don't move with it. To keep nodes together, use a boundary."
          : "Annotations don't take part in the simulation."}
      </p>
      <CopyId id={id} />
    </Section>
  );
}

/** A pixel size: free typing, applied on Enter or blur (never below `min`). */
function SizeInput({
  label,
  value,
  min,
  testId,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  testId: string;
  onCommit: (v: number) => void;
}) {
  const shown = String(Math.round(value));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Math.round(Number(draft));
    setDraft(null);
    if (Number.isFinite(v) && v !== Math.round(value))
      onCommit(Math.max(min, Math.min(ANNOTATION_LIMITS.maxAnnotationSize, v)));
  };
  return (
    <input
      className="insp-input mono"
      inputMode="numeric"
      value={draft ?? shown}
      aria-label={label}
      title={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
      name={testId}
      data-testid={testId}
    />
  );
}

const ALIGN_BUTTONS: { mode: AlignMode; icon: IconName; label: string }[] = [
  { mode: "left", icon: "align-left", label: "Align left" },
  { mode: "center", icon: "align-center", label: "Align centres" },
  { mode: "right", icon: "align-right", label: "Align right" },
  { mode: "top", icon: "align-top", label: "Align top" },
  { mode: "middle", icon: "align-middle", label: "Align middles" },
  { mode: "bottom", icon: "align-bottom", label: "Align bottom" },
];

/** What every item of a list shares: the one value, or MIXED when they differ (undefined when the list is empty). */
const MIXED = Symbol("mixed");
function shared<T, V>(items: readonly T[], read: (t: T) => V): V | typeof MIXED | undefined {
  if (!items.length) return undefined;
  const first = read(items[0]);
  return items.every((i) => read(i) === first) ? first : MIXED;
}

/** A fresh undo tag per click: one bulk change is one undo step, and the next click is another. */
let bulkSeq = 0;
const bulkStep = (what: string) => ({ merge: `bulk:${what}:${++bulkSeq}` });

function MultiPanel(p: InspectorProps) {
  const { editor, selectedNodes, selectedEdges, selectedGroups, selectedAnnotations = [] } = p;
  const nodeIds = selectedNodes.map((n) => n.id);
  // Align and distribute arrange nodes and annotations alike; Tidy up lays out nodes (and their edges).
  const ids = [...nodeIds, ...selectedAnnotations.map((n) => n.id)];
  return (
    <>
      <Section>
        {ids.length > 1 ? (
          <Field label="Arrange" group>
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
                  title="Distribute horizontally"
                  aria-label="Distribute horizontally"
                  onClick={() => editor.distribute(ids, "h")}
                  data-testid="inspector-distribute-h"
                >
                  <Icon name="distribute-h" />
                </button>
                <button
                  className="icon-btn"
                  title="Distribute vertically"
                  aria-label="Distribute vertically"
                  onClick={() => editor.distribute(ids, "v")}
                  data-testid="inspector-distribute-v"
                >
                  <Icon name="distribute-v" />
                </button>
                {nodeIds.length > 2 && (
                  <button
                    className="btn insp-tidy"
                    title="Lay out just these nodes by their connections; nothing else moves"
                    onClick={() => editor.tidy(nodeIds)}
                    data-testid="inspector-tidy"
                  >
                    <Icon name="layout" size={14} /> Tidy up
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
        <Section title={plural(selectedAnnotations.length, "annotation", "annotations")}>
          <BulkAnnotations selectedAnnotations={selectedAnnotations} editor={editor} />
        </Section>
      )}
      {selectedGroups.length > 0 && (
        <Section title={plural(selectedGroups.length, "boundary", "boundaries")}>
          <BulkSwatches
            testId="inspector-field-tone"
            itemTestId="inspector-tone"
            options={(Object.keys(toneColor) as GroupTone[]).map((t) => ({
              id: t,
              colour: toneColor[t],
              label: toneLabel[t],
            }))}
            value={shared(selectedGroups, (g) => g.data.tone)}
            onPick={(t) =>
              editor.updateGroups(
                selectedGroups.map((g) => g.data.groupId),
                { tone: t },
                bulkStep("tone"),
              )
            }
          />
        </Section>
      )}
      <Section>
        <div className="insp-actions">
          {nodeIds.length > 0 && (
            <button className="btn" onClick={() => editor.groupNodes(nodeIds)} data-testid="inspector-group-selection">
              <Icon name="boundary" size={14} /> Add boundary
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
            <Icon name="trash" size={14} /> Delete
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
    nodeSimFields(getStencil(n.data.stencil).simRole, n.data.stencil, meta.planning),
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
  return (
    <>
      <Section title={plural(ids.length, "node", "nodes")}>
        <BulkRow label="Stencil">
          <button
            className="insp-stencil insp-stencil-compact"
            data-testid="inspector-field-stencil"
            data-mixed={stencil ? undefined : "true"}
            aria-label={`Stencil: ${stencil ? stencil.label : "Mixed"}. Change the stencil of ${ids.length} nodes`}
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
            <span className="insp-stencil-name">{stencil ? stencil.label : <em className="insp-mixed">Mixed</em>}</span>
            <Icon name="chevron-down" size={14} />
          </button>
        </BulkRow>
        <BulkRow label="Boundary">
          <select
            className="insp-input"
            value={group === MIXED ? MIXED_VALUE : (group ?? "")}
            onChange={(e) =>
              e.target.value !== MIXED_VALUE &&
              editor.updateNodes(ids, { group: e.target.value || undefined }, bulkStep("group"))
            }
            name="group"
            aria-label={`Boundary of ${ids.length} nodes`}
            data-testid="inspector-field-group"
          >
            {group === MIXED && (
              <option value={MIXED_VALUE} disabled>
                Mixed
              </option>
            )}
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.data.groupId}>
                {g.data.label}
              </option>
            ))}
          </select>
        </BulkRow>
      </Section>
      {simKeys.length > 0 && (
        <Disclosure id="multi-simulation" title="Simulation">
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
                  ...(value === MIXED ? { placeholder: "Mixed" } : {}),
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
          label="Change stencil"
          testId="stencil-picker"
          searchable="Search stencils"
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
    <Section title={plural(ids.length, "edge", "edges")}>
      <BulkRow label="Relationship">
        <select
          className="insp-input"
          value={choice === MIXED ? MIXED_VALUE : choice}
          onChange={(e) => {
            const next = RELATION_CHOICES.find((c) => c.id === e.target.value);
            if (next) applyChoice(editor, ids, next);
          }}
          name="relationship"
          aria-label={`Relationship of ${ids.length} edges`}
          data-testid="inspector-field-relation"
        >
          {choice === MIXED && (
            <option value={MIXED_VALUE} disabled>
              Mixed
            </option>
          )}
          <optgroup label="Flow">
            {RELATION_CHOICES.filter((c) => c.relation === "flow").map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.kind})
              </option>
            ))}
          </optgroup>
          <optgroup label="Dependency">
            {RELATION_CHOICES.filter((c) => c.relation !== "flow").map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </optgroup>
        </select>
      </BulkRow>
      <BulkRow label="Label">
        <input
          className="insp-input"
          value={label === MIXED ? "" : (label ?? "")}
          placeholder={label === MIXED ? "Mixed" : "e.g. OrderPlaced"}
          onChange={(e) => editor.updateEdges(ids, { label: e.target.value }, { merge: `bulk:${ids.join(",")}:label` })}
          name="edge-label"
          aria-label={`Label of ${ids.length} edges`}
          data-testid="inspector-field-label"
        />
      </BulkRow>
    </Section>
  );
}

function BulkAnnotations({
  selectedAnnotations,
  editor,
}: {
  selectedAnnotations: AnnotationFlowNode[];
  editor: EditorApi;
}) {
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
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
          label: ANNOTATION_COLORS[c].label,
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
            title="Custom colour"
            aria-label="Custom colour"
            aria-haspopup="dialog"
            onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}
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
          currentColor={resolved.hex}
          defaultColor={ANNOTATION_COLORS[defaultColor[firstKind]].hex}
          anchorRect={pickerAnchor}
          onSelect={(hex) =>
            editor.updateAnnotations(
              selectedAnnotations.map((a) => a.id),
              { color: hex },
              bulkStep("annotation-colour"),
            )
          }
          onClose={() => setPickerAnchor(null)}
        />
      )}
    </>
  );
}

/** The value a select shows while the selection differs (a disabled "Mixed" option). */
const MIXED_VALUE = "__mixed";

/** A compact label-and-control row, so a mixed selection's panel fits one screen. */
function BulkRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="insp-bulk-row">
      <span className="insp-label">{label}</span>
      {children}
    </div>
  );
}

/** Colour swatches for several things: none ticked, and "Mixed" beside the label, while they differ. */
function BulkSwatches<T extends string>({
  options,
  value,
  onPick,
  testId,
  itemTestId,
  customButton,
}: {
  options: { id: T; colour: string; label: string }[];
  value: T | typeof MIXED | undefined;
  onPick: (v: T) => void;
  testId: string;
  itemTestId: string;
  customButton?: ReactNode;
}) {
  return (
    <div className="insp-bulk-row">
      <span className="insp-label">
        Colour
        {value === MIXED && (
          <em className="insp-mixed" data-testid={`${testId}-mixed`}>
            Mixed
          </em>
        )}
      </span>
      <div className="insp-tones insp-tones-compact" data-testid={testId} role="radiogroup" aria-label="Colour">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={`insp-tone${value === o.id ? " is-on" : ""}`}
            style={{ "--tone": o.colour } as CSSProperties}
            title={o.label}
            aria-label={o.label}
            data-color={o.id}
            onClick={() => onPick(o.id)}
            data-testid={`${itemTestId}-${o.id}`}
          />
        ))}
        {customButton}
      </div>
    </div>
  );
}

function DiagramPanel({ editor, meta, counts }: InspectorProps) {
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const color = meta.color;
  const isCustomColor = !!color && !ANNOTATION_COLOR_IDS.includes(color as (typeof ANNOTATION_COLOR_IDS)[number]);
  const resolved = color ? resolveAnnotationColor(color) : null;

  return (
    <>
      <PlanningUpgrade editor={editor} planning={meta.planning} />
      <Section>
        <Field label="Title">
          <input
            className="insp-input"
            value={meta.title}
            onChange={(e) => editor.updateMeta({ title: e.target.value }, { merge: "inspector:meta:title" })}
            name="title"
            data-testid="inspector-field-title"
          />
        </Field>
        <Field label="Description">
          <textarea
            className="insp-input"
            rows={3}
            value={meta.description ?? ""}
            placeholder="What does this diagram show?"
            onChange={(e) =>
              editor.updateMeta({ description: e.target.value || undefined }, { merge: "inspector:meta:description" })
            }
            name="description"
            data-testid="inspector-field-description"
          />
        </Field>
        <Field label="Colour" hint="Canvas background tint" group>
          <div className="insp-tones" data-testid="inspector-field-diagram-color" role="radiogroup" aria-label="Colour">
            {ANNOTATION_COLOR_IDS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={`insp-tone${color === c ? " is-on" : ""}`}
                style={{ "--tone": ANNOTATION_COLORS[c].hex } as CSSProperties}
                title={ANNOTATION_COLORS[c].label}
                aria-label={ANNOTATION_COLORS[c].label}
                data-color={c}
                onClick={() => editor.updateMeta({ color: color === c ? undefined : c })}
                data-testid={`inspector-diagram-color-${c}`}
              />
            ))}
            <button
              type="button"
              className={`insp-tone-custom${isCustomColor ? " is-on" : ""}`}
              title="Custom colour"
              aria-label="Custom colour"
              aria-haspopup="dialog"
              onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}
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
            currentColor={resolved?.hex ?? "#3B82F6"}
            defaultColor="#3B82F6"
            anchorRect={pickerAnchor}
            onSelect={(hex) => editor.updateMeta({ color: hex })}
            onReset={() => {
              editor.updateMeta({ color: undefined });
              setPickerAnchor(null);
            }}
            onClose={() => setPickerAnchor(null)}
          />
        )}
        <Field label="Flow direction" hint="Edges prefer this axis when picking sides; auto-layout follows it" group>
          <Segmented
            testId="inspector-field-direction"
            label="Flow direction"
            value={meta.direction ?? "LR"}
            options={[
              { value: "LR", label: "Left → right" },
              { value: "TB", label: "Top → bottom" },
            ]}
            onChange={(direction) => editor.updateMeta({ direction })}
          />
        </Field>
      </Section>
      <Section>
        <p className="insp-note">{countText(counts.nodes, counts.edges, counts.groups)}</p>
        <p className="insp-note">Select a node, edge or boundary to edit it. Right-click anything for its actions.</p>
        <button className="link-btn" onClick={() => editor.showShortcuts()} data-testid="inspector-shortcuts">
          <Icon name="keyboard" size={13} /> Keyboard shortcuts
        </button>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- controls

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "15 nodes, 15 edges, 1 boundary" (zero boundaries and annotations are left out). */
function countText(nodes: number, edges: number, boundaries: number, annotations = 0): string {
  return [plural(nodes, "node", "nodes"), plural(edges, "edge", "edges")]
    .concat(boundaries ? [plural(boundaries, "boundary", "boundaries")] : [])
    .concat(annotations ? [plural(annotations, "annotation", "annotations")] : [])
    .join(", ");
}

const customCount = (props: Record<string, unknown>, hidden: Set<string>) =>
  Object.keys(props).filter((k) => !hidden.has(k)).length;

/** The node id as a copy chip: click copies it. */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="copy-chip insp-id"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(id)
          .then(() => setCopied(true))
          .catch(() => {})
      }
      title="Copy id"
      aria-label={`Copy id ${id}`}
      data-testid="inspector-copy-id"
    >
      <Icon name={copied ? "check" : "hash"} size={12} />
      <span className="mono">{copied ? "Copied" : id}</span>
    </button>
  );
}

const OPEN_KEY = "diagrams.inspector.open.v1";
function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(safeStorage.getItem(OPEN_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** A collapsed-by-default section; it stays open once you've opened it (per browser). */
function Disclosure({
  id,
  title,
  aside,
  count,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen()[id] === true);
  const toggle = () => {
    setOpen(!open);
    safeStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: !open }));
  };
  return (
    <section className={`insp-section insp-disclosure${open ? " is-open" : ""}`}>
      <h3>
        <button
          type="button"
          className="insp-disclosure-head"
          aria-expanded={open}
          onClick={toggle}
          data-testid={`inspector-section-${id}`}
        >
          <Icon name="chevron-right" size={12} />
          {title}
          {!!count && <span className="insp-count">{count}</span>}
        </button>
        {aside}
      </h3>
      {open && children}
    </section>
  );
}

/**
 * A network device's simulation settings: a size preset (its datasheet's throughput and latency), the throughput
 * itself, high availability, and for ADCs health checks. Picking a size clears the throughput and latency typed
 * over the old one, so the new preset shows through.
 */
function DeviceFields({
  spec,
  props,
  set,
}: {
  spec: DeviceSpec;
  props: Record<string, unknown>;
  set: (patch: Record<string, unknown>, mergeKey?: string) => void;
}) {
  const size: DeviceSize = sizeOf(spec, props.size);
  const preset = presetOf(spec, size);
  const ha: DeviceHa = isDeviceHa(props.ha) ? props.ha : "standalone";
  const num = (key: string, fallback: number) => {
    const v = props[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const gbps = num("gbps", preset.gbps);
  const kb = num("messageKB", DEFAULT_MESSAGE_KB);
  return (
    <>
      <Field label="Size" hint="Each size's numbers come from a model's datasheet: approximate, and yours to change">
        <select
          className="insp-input"
          value={size}
          onChange={(e) => {
            const size = sizeOf(spec, e.target.value);
            const preset = presetOf(spec, size);
            set(
              props.preset === "device-size"
                ? { size, gbps: preset.gbps, latencyMs: preset.latencyMs }
                : { size, gbps: undefined, latencyMs: undefined },
            );
          }}
          name="size"
          data-testid="inspector-field-size"
        >
          {sizesOf(spec).map((s) => (
            <option key={s} value={s}>
              {SIZE_LABEL[s]}: {presetOf(spec, s).model}, {formatGbps(presetOf(spec, s).gbps)}
            </option>
          ))}
        </select>
      </Field>
      <SimInput
        name="gbps"
        field={{
          label: "Throughput",
          unit: "Gbps",
          kind: "number",
          min: 0,
          max: 1_000_000,
          step: 0.5,
          placeholder: String(preset.gbps),
          hint: `Per unit, with its usual inspection on. Default: the ${preset.model} datasheet figure`,
        }}
        value={props.gbps}
        onChange={(v) => set({ gbps: v }, "gbps")}
      />
      <p className="insp-note" data-testid="inspector-device-rate">
        About {formatCount(messagesPerSec(gbps, kb))} messages/s per unit at {kb} kB each. From the {preset.model}{" "}
        datasheet: approximate.
      </p>
      <Field label="High availability">
        <select
          className="insp-input"
          value={ha}
          onChange={(e) => {
            const next = e.target.value as DeviceHa;
            set(
              next === "standalone"
                ? { ha: undefined, replicas: undefined, failoverMs: undefined }
                : { ha: next, replicas: Math.max(2, num("replicas", 2)) },
            );
          }}
          name="ha"
          data-testid="inspector-field-ha"
        >
          {(Object.keys(HA_LABEL) as DeviceHa[]).map((h) => (
            <option key={h} value={h}>
              {HA_LABEL[h]}
            </option>
          ))}
        </select>
      </Field>
      {ha !== "standalone" && (
        <SimInput
          name="replicas"
          field={{
            label: "Units",
            kind: "number",
            min: 1,
            max: 10_000,
            step: 1,
            placeholder: "2",
            hint:
              ha === "active-standby"
                ? "Boxes in the pair: one carries traffic, the other takes over when it fails"
                : "Boxes sharing the traffic: their throughput adds up",
          }}
          value={props.replicas}
          onChange={(v) => set({ replicas: v }, "replicas")}
        />
      )}
      <SimInput
        name="latencyMs"
        field={{
          label: "Latency",
          unit: "ms",
          kind: "number",
          min: 0,
          max: 600_000,
          step: 0.05,
          placeholder: String(preset.latencyMs),
          hint: "Time through the device, per message",
        }}
        value={props.latencyMs}
        onChange={(v) => set({ latencyMs: v }, "latencyMs")}
      />
      {spec.kind === "adc" && (
        <label className="insp-check">
          <input
            type="checkbox"
            checked={props.healthChecks !== false}
            onChange={(e) => set({ healthChecks: e.target.checked ? undefined : false })}
            name="healthChecks"
            data-testid="inspector-field-healthChecks"
          />
          <span>
            Health checks
            <small>Targets that are down get no traffic</small>
          </span>
        </label>
      )}
      <div className="insp-row2">
        <SimInput
          name="messageKB"
          field={{
            label: "Message size",
            unit: "kB",
            kind: "number",
            min: 0.01,
            max: 1_000_000,
            step: 1,
            placeholder: String(DEFAULT_MESSAGE_KB),
            hint: "The average message the throughput is converted with (1 kB = 1,000 bytes)",
          }}
          value={props.messageKB}
          onChange={(v) => set({ messageKB: v }, "messageKB")}
        />
        {ha === "active-standby" && (
          <SimInput
            name="failoverMs"
            field={{
              label: "Failover",
              unit: "ms",
              kind: "number",
              min: 0,
              max: 600_000,
              step: 100,
              placeholder: String(DEFAULT_FAILOVER_MS),
              hint: "How long traffic waits when the active unit fails and the standby takes over",
            }}
            value={props.failoverMs}
            onChange={(v) => set({ failoverMs: v }, "failoverMs")}
          />
        )}
      </div>
    </>
  );
}

const formatGbps = (gbps: number) =>
  gbps >= 1000 ? `${Math.round(gbps / 100) / 10} Tbps` : gbps >= 1 ? `${gbps} Gbps` : `${Math.round(gbps * 1000)} Mbps`;

function Section({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="insp-section">
      {title && (
        <h3>
          {title}
          {aside}
        </h3>
      )}
      {children}
    </section>
  );
}

/** Labelled row. `group` renders a div (for button groups — a <label> would forward clicks). */
function Field({
  label,
  hint,
  group,
  children,
}: {
  label: string;
  hint?: string;
  group?: boolean;
  children: ReactNode;
}) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="insp-field" title={hint}>
      <span className="insp-label">{label}</span>
      {children}
    </Tag>
  );
}

/**
 * A radio group drawn as a segmented control: named by `label`, one Tab stop (the checked option), and the arrow keys,
 * Home and End move the choice, as the WAI-ARIA radio group pattern says.
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
  label,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  testId: string;
  label: string;
}) {
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    const group = e.currentTarget.parentElement;
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div className="segmented insp-seg" role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === current ? 0 : -1}
          className={value === o.value ? "is-on" : ""}
          title={o.hint}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => move(e, i)}
          data-testid={`${testId}-${o.value}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SideSelect({
  value,
  onChange,
  testId,
}: {
  value?: Side;
  onChange: (v: Side | undefined) => void;
  testId: string;
}) {
  return (
    <select
      className="insp-input"
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || undefined) as Side | undefined)}
      data-testid={testId}
      name={testId}
    >
      <option value="">Auto</option>
      {SIDES.map((s) => (
        <option key={s} value={s}>
          {s[0].toUpperCase() + s.slice(1)}
        </option>
      ))}
    </select>
  );
}

/** Number / text input that keeps a local draft so partially typed numbers ("0.") survive. */
function showSim(kind: SimField["kind"], value: unknown): string {
  if (value === undefined || value === null) return "";
  if (kind === "list" && Array.isArray(value)) return value.join(", ");
  if (kind === "map" && typeof value === "object" && !Array.isArray(value))
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} → ${String(v)}`)
      .join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

type SimValue = number | string | string[] | Record<string, string> | undefined;

function SimInput({
  name,
  field,
  value,
  onChange,
}: {
  name: string;
  field: SimField;
  value: unknown;
  onChange: (v: SimValue) => void;
}) {
  const external = showSim(field.kind, value);
  const [draft, setDraft] = useState(external);
  // A number past the field's bound is saved at the bound, and says so while it's typed.
  const [over, setOver] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(external);
  }, [external]);
  return (
    <>
      <Field label={field.label} hint={field.hint}>
        <span className="insp-unit-wrap">
          <input
            className={`insp-input${field.kind === "number" ? " mono" : ""}`}
            type={field.kind === "number" ? "number" : "text"}
            inputMode={field.kind === "number" ? "decimal" : undefined}
            min={field.min}
            max={field.max}
            step={field.step}
            value={draft}
            placeholder={field.placeholder}
            onFocus={() => (focused.current = true)}
            onBlur={() => {
              focused.current = false;
              setDraft(external);
              setOver(false);
            }}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              setOver(field.kind === "number" && field.max !== undefined && Number(raw) > field.max);
              if (field.kind === "text") return onChange(raw || undefined);
              if (field.kind === "list") {
                const items = raw
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean);
                return onChange(items.length ? items : undefined);
              }
              if (field.kind === "map") {
                const parsed = parseEmits(raw);
                if (parsed !== null) onChange(parsed);
                return;
              }
              if (raw.trim() === "") return onChange(undefined);
              const v = Number(raw);
              // Each bound on its own: a value the file format would reject never reaches the diagram.
              if (Number.isFinite(v)) onChange(Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, v)));
            }}
            name={name}
            data-testid={`inspector-field-${name}`}
          />
          {field.unit && <span className="insp-unit">{field.unit}</span>}
        </span>
        {over && field.max !== undefined && (
          <small className="insp-note" role="status" data-testid={`inspector-limit-${name}`}>
            Up to {field.max.toLocaleString("en-US")}
            {field.unit && field.unit !== "0–1" ? ` ${field.unit}` : ""}: saved as {field.max.toLocaleString("en-US")}.
          </small>
        )}
      </Field>
      {field.note && (
        <p className="insp-note insp-field-note" data-testid={`inspector-note-${name}`}>
          {field.note}
        </p>
      )}
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
      aria-label={`Value of ${name}`}
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
            title={`Remove ${k}`}
            aria-label={`Remove ${k}`}
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
          placeholder="Add property…"
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label="New property name"
          name="new-prop"
          data-testid="inspector-prop-new"
        />
        <button
          className="icon-btn insp-mini"
          onClick={add}
          disabled={!newKey.trim()}
          title="Add property"
          aria-label="Add property"
          data-testid="inspector-prop-add"
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
    </div>
  );
}
