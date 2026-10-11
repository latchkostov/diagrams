import { ANNOTATION_LIMITS } from "../model/annotations";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getStencil } from "../stencils/registry";
import { simRoleMeta } from "../lib/simRoles";
import type { NodeSimProps } from "../sim/types";
import type { Side, SimRole } from "../model/types";
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
  kindLabel,
  minSize,
  shapeLabel,
  textSizeLabel,
} from "./annotations";
import { safeStorage } from "../lib/storage";
import {
  RELATION_META,
  edgeSettings,
  isDependency,
  parseSettings,
  parseSettingsEditor,
  MAX_SETTINGS_TEXT,
  relationOf,
  settingsSummary,
  settingsText,
  type ConfigSetting,
} from "../model/relations";
import { RELATION_CHOICES, applyChoice, choiceOf, relationIcon } from "../editor/relationActions";
import { inferRelation } from "../stencils/relations";

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
}

// Partial on purpose: engine knobs without a designed field yet stay editable under "Custom properties".
const SIM_FIELDS: Partial<Record<SimKey, SimField>> = {
  ratePerSec: {
    label: "Rate",
    unit: "msg/s",
    kind: "number",
    min: 0,
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
    step: 10,
    placeholder: "default",
    hint: "Processing time per message",
  },
  concurrency: {
    label: "Concurrency",
    kind: "number",
    min: 1,
    step: 1,
    placeholder: "4",
    hint: "Messages processed in parallel per replica",
  },
  replicas: {
    label: "Replicas",
    kind: "number",
    min: 1,
    step: 1,
    placeholder: "1",
    hint: "Instances (pods); behind a topic, only as many as there are partitions do work",
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
    step: 1,
    placeholder: "3",
    hint: "Attempts before dead-lettering",
  },
  partitions: {
    label: "Partitions",
    kind: "number",
    min: 1,
    step: 1,
    placeholder: "3",
    hint: "Max in-flight deliveries per consumer group",
  },
  emits: {
    label: "Emits",
    kind: "map",
    placeholder: "unchanged, or In → Out, * → Other",
    hint: "Message type sent downstream. One name renames everything; `OrderPlaced → PaymentRequested, * → Other` maps by incoming type (* = fallback).",
  },
};

/** Which simulation tunables apply to each role. */
const SIM_FIELDS_BY_ROLE: Record<SimRole, SimKey[]> = {
  source: ["ratePerSec", "messageType"],
  processor: ["replicas", "latencyMs", "concurrency", "failureRate", "emits"],
  gateway: ["latencyMs", "concurrency"],
  store: ["latencyMs"],
  sink: ["latencyMs"],
  topic: ["partitions", "maxDeliveryCount"],
  stream: ["partitions", "maxDeliveryCount"],
  queue: ["maxDeliveryCount"],
  none: [],
};

const SIM_KEYS = new Set<string>(Object.keys(SIM_FIELDS));
const EDGE_KEYS = new Set(["group", "dlq", "travelMs", "filter", "emits", "share", "settings"]);
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
  /** Focus request: `inspector-field-<name>`; `seq` re-triggers for the same name. */
  focus?: { name: string; seq: number };
  /** A text's edit is done (see DiagramUi.settleText): it moves clear if it grew over something. */
  onTextSettled?: (id: string, before: { x: number; y: number; width: number; height: number }) => void;
}

export function Inspector(p: InspectorProps) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.focus || p.collapsed) return;
    const id = requestAnimationFrame(() => {
      const el = body.current?.querySelector<HTMLElement>(`[data-testid="inspector-field-${p.focus!.name}"]`);
      el?.focus();
      if (el instanceof HTMLInputElement) el.select();
    });
    return () => cancelAnimationFrame(id);
  }, [p.focus, p.collapsed]);

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
      <div className="insp-body" ref={body}>
        {content}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- panels

function NodePanel({ node, editor, groups }: InspectorProps & { node: DiagramFlowNode }) {
  const stencil = getStencil(node.data.stencil);
  const role = stencil.simRole;
  const props = node.data.props ?? {};
  const merge = (f: string) => ({ merge: `inspector:node:${node.id}:${f}` });
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const simFields = SIM_FIELDS_BY_ROLE[role];

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
            onChange={(e) => editor.updateNode(node.id, { label: e.target.value }, merge("label"))}
            name="label"
            data-testid="inspector-field-label"
          />
        </Field>
        <Field label="Subtitle">
          <input
            className="insp-input mono"
            value={node.data.sublabel ?? ""}
            placeholder={stencil.label}
            onChange={(e) => editor.updateNode(node.id, { sublabel: e.target.value }, merge("sublabel"))}
            name="sublabel"
            data-testid="inspector-field-sublabel"
          />
        </Field>
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
        {simFields.length ? (
          simFields.map((k) => (
            <SimInput
              key={k}
              name={k}
              field={SIM_FIELDS[k]!}
              value={props[k]}
              onChange={(v) => editor.setNodeProps(node.id, { [k]: v }, merge(k))}
            />
          ))
        ) : (
          <p className="insp-note">This stencil is decorative and doesn't take part in the simulation.</p>
        )}
      </Disclosure>

      <Disclosure id="node-properties" title="Custom properties" count={customCount(props, SIM_KEYS)}>
        <PropsEditor
          props={props}
          hidden={SIM_KEYS}
          onSet={(patch) => editor.setNodeProps(node.id, patch)}
          onSetMerged={(patch, key) => editor.setNodeProps(node.id, patch, merge(`prop:${key}`))}
        />
      </Disclosure>

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

function EdgePanel({ edge, editor, nodeLabel }: InspectorProps & { edge: DiagramFlowEdge }) {
  const data = edge.data ?? { kind: "async" as const };
  const props = data.props ?? {};
  const merge = (f: string) => ({ merge: `inspector:edge:${edge.id}:${f}` });
  const relation = relationOf(data);
  const flow = relation === "flow";
  const fanOut = flow && isFanOut(editor, edge.source, data.kind);
  const choice = choiceOf(data);
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
            onChange={(e) => editor.updateEdge(edge.id, { label: e.target.value }, merge("label"))}
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
        {flow && (
          <>
            <Field label="Consumer group" hint="Edges from a topic sharing a group compete for messages">
              <input
                className="insp-input mono"
                value={typeof props.group === "string" ? props.group : ""}
                placeholder={edge.id}
                onChange={(e) => editor.setEdgeProps(edge.id, { group: e.target.value || undefined }, merge("group"))}
                name="consumer-group"
                data-testid="inspector-field-group"
              />
            </Field>
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
          </>
        )}
        {!flow && (
          <p className="insp-note" data-testid="inspector-relation-note">
            {RELATION_META[relation].hint}. No messages flow here in Live.
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
                step: 50,
                placeholder: data.kind === "sync" ? "450" : "900",
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
          hidden={EDGE_KEYS}
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
                <Icon name="lock" size={12} />
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
  const id = group.data.groupId;
  return (
    <Section>
      <Field label="Label">
        <input
          className="insp-input"
          value={group.data.label}
          onChange={(e) => editor.updateGroup(id, { label: e.target.value }, { merge: `inspector:group:${id}:label` })}
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
              onClick={() => editor.updateAnnotation(id, { color: c })}
              data-testid={`inspector-color-${c}`}
            />
          ))}
        </div>
      </Field>
      {/* A zone's label is a label, like a boundary's: one size. */}
      {kind !== "zone" && (
        <Field label="Text size" group>
          <Segmented
            testId="inspector-field-text-size"
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

function MultiPanel({
  editor,
  selectedNodes,
  selectedEdges,
  selectedGroups,
  selectedAnnotations = [],
}: InspectorProps) {
  const nodeIds = selectedNodes.map((n) => n.id);
  // Align and distribute arrange nodes and annotations alike.
  const ids = [...nodeIds, ...selectedAnnotations.map((n) => n.id)];
  return (
    <Section>
      <p className="insp-note">
        {countText(selectedNodes.length, selectedEdges.length, selectedGroups.length, selectedAnnotations.length)}
      </p>
      {ids.length > 1 && (
        <Field label="Align" group>
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
        </Field>
      )}
      {ids.length > 2 && (
        <Field label="Distribute" group>
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
          </div>
        </Field>
      )}
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
  );
}

function DiagramPanel({ editor, meta, counts }: InspectorProps) {
  return (
    <>
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
        <Field label="Flow direction" hint="Edges prefer this axis when picking sides; auto-layout follows it" group>
          <Segmented
            testId="inspector-field-direction"
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

function Segmented<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  testId: string;
}) {
  return (
    <div className="segmented insp-seg" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "is-on" : ""}
          title={o.hint}
          onClick={() => onChange(o.value)}
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
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(external);
  }, [external]);
  return (
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
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
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
            if (Number.isFinite(v))
              onChange(field.max !== undefined ? Math.min(field.max, Math.max(field.min ?? -Infinity, v)) : v);
          }}
          name={name}
          data-testid={`inspector-field-${name}`}
        />
        {field.unit && <span className="insp-unit">{field.unit}</span>}
      </span>
    </Field>
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
