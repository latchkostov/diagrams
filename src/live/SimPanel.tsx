import { DRILL_PRESETS, type DrillPreset } from "../model/faults";
import { FaultStep } from "./FaultStep";
import { defaultFault, drillFault, drillName } from "./faults";
import { t as translate, useLocale } from "../i18n";
import { flowEdges } from "../model/relations";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStoreApi } from "@xyflow/react";
import type {
  DiagramFile,
  Expectation,
  MetricField,
  Simulation,
  TimelineAction,
  TimelineStep,
  TrafficProfile,
  TrafficShape,
} from "../model/types";
import type { LiveState } from "./controller";
import { useLive } from "./context";
import { blankSimulation, defaultShape, knownMessageTypes, suggestedMessageType, uniqueSimId } from "./storm";
import { simulationWarnings, type SimWarning } from "./validate";
import { Sparkline } from "./Sparkline";
import { LiveIcon } from "./icons";
import { formatSeconds } from "./format";
import { usePanelEscape } from "./usePanelEscape";

interface Props {
  /** Simulation to open for editing; null shows the list. */
  initial: Simulation | null;
  state: LiveState;
  onClose: () => void;
  onRun: (sim: Simulation) => void;
  onSave: (sim: Simulation) => void;
  onDelete: (id: string) => void;
  /** A simulation from the list was opened for editing (the live bar then shows it, not free play). */
  onOpen?: (sim: Simulation) => void;
  /** Retain the working copy when the inspector temporarily takes this panel's place. */
  onDraftChange?: (sim: Simulation | null) => void;
}

type Picker = { label: string; apply: (nodeId: string) => void } | null;

const SHAPES: { kind: TrafficShape["kind"]; label: string }[] = [
  { kind: "burst", label: "Burst" },
  { kind: "constant", label: "Constant" },
  { kind: "ramp", label: "Ramp" },
  { kind: "spike", label: "Spike" },
];
const ACTIONS: { value: Exclude<TimelineAction["do"], "fault">; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "status", label: "Set status" },
  { value: "props", label: "Change prop" },
  { value: "inject", label: "Inject" },
  { value: "trace", label: "Trace a message" },
];
const FIELDS: { value: MetricField; label: string }[] = [
  { value: "processed", label: "processed" },
  { value: "backlog", label: "backlog" },
  { value: "lag", label: "lag" },
  { value: "inFlight", label: "in flight" },
  { value: "failed", label: "failed" },
  { value: "deadLettered", label: "dead-lettered" },
  { value: "dropped", label: "dropped" },
  { value: "blocked", label: "blocked" },
  { value: "rejected", label: "rejected" },
  { value: "throughput", label: "throughput" },
];
const OPS: Expectation["op"][] = ["==", ">=", ">", "<=", "<"];
const WHENS: { value: NonNullable<Expectation["when"]>; label: string }[] = [
  { value: "end", label: "at the end" },
  { value: "always", label: "always" },
  { value: "eventually", label: "eventually" },
  { value: "at", label: "at time" },
];
const PROP_KEYS = ["latencyMs", "concurrency", "failureRate", "partitions", "ratePerSec", "maxDeliveryCount"] as const;

const sec = (ms: number | undefined) => Math.round(((ms ?? 0) / 1000) * 100) / 100;
const ms = (s: number) => Math.max(0, Math.round((Number.isFinite(s) ? s : 0) * 1000));
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

/**
 * Right-side drawer to create and edit the diagram's saved simulations. Edits a working copy;
 * Save writes it through the editor (one undo step) and Run plays it immediately, saved or not.
 */
export function SimPanel({ initial, state, onClose, onRun, onSave, onDelete, onOpen, onDraftChange }: Props) {
  useLocale();
  const ui = useLive();
  const diagram = ui.diagram();
  const [sim, setSim] = useState<Simulation | null>(() => (initial ? structuredClone(initial) : null));
  useLayoutEffect(() => onDraftChange?.(sim), [sim, onDraftChange]);
  const [picker, setPicker] = useState<Picker>(null);
  const saved = sim ? ui.simulations.find((s) => s.id === sim.id) : undefined;
  const dirty = !!sim && (!saved || JSON.stringify(saved) !== JSON.stringify(sim));
  const warnings = useMemo(() => (sim ? simulationWarnings(sim, diagram) : []), [sim, diagram]);
  const types = useMemo(() => knownMessageTypes(diagram), [diagram]);

  usePickNode(picker, () => setPicker(null));
  // Esc cancels a node pick first, then closes the panel.
  usePanelEscape(onClose, () => {
    if (!picker) return false;
    setPicker(null);
    return true;
  });

  const edit = (fn: (draft: Simulation) => void) =>
    setSim((s) => {
      if (!s) return s;
      const next = structuredClone(s);
      fn(next);
      return next;
    });

  const running = state.simulation?.id === sim?.id;

  return (
    <aside className="lv-panel" data-testid="sim-panel" data-editor-overlay aria-label="Simulations">
      <header className="lv-panel-head">
        {sim ? (
          <button
            className="lv-btn"
            onClick={() => setSim(null)}
            title="All simulations"
            aria-label="All simulations"
            data-testid="sim-panel-back"
          >
            <LiveIcon name="chevron" size={13} className="lv-rot90" />
          </button>
        ) : (
          <LiveIcon name="storm" size={16} />
        )}
        <strong>{sim ? (saved ? "Edit simulation" : "New simulation") : "Simulations"}</strong>
        {dirty && (
          <span className="lv-dirty" data-testid="sim-panel-dirty">
            unsaved
          </span>
        )}
        <button className="lv-btn lv-panel-close" onClick={onClose} aria-label="Close" data-testid="sim-panel-close">
          <LiveIcon name="close" size={13} />
        </button>
      </header>

      {picker && (
        <div className="lv-picking" data-testid="sim-panel-picking">
          <LiveIcon name="target" size={14} /> Click a node on the canvas for <b>{picker.label}</b>
          <button className="link-btn" onClick={() => setPicker(null)}>
            Cancel
          </button>
        </div>
      )}

      {!sim ? (
        <SimList
          onEdit={(s) => {
            setSim(structuredClone(s));
            onOpen?.(s);
          }}
          onNew={() => setSim(blankSimulation(diagram))}
          onRun={onRun}
          running={state.simulation?.id ?? null}
        />
      ) : (
        <div className="lv-panel-body">
          <input
            className="lv-title-input"
            value={sim.title}
            placeholder="Name this simulation"
            aria-label="Title"
            onChange={(e) => edit((d) => void (d.title = e.target.value))}
            data-testid="sim-panel-title"
            name="sim-title"
          />

          <Section
            title="Traffic"
            count={sim.traffic.length}
            warn={warnings.some((w) => w.where.startsWith("traffic"))}
          >
            {sim.traffic.map((p, i) => (
              <TrafficCard
                key={i}
                index={i}
                profile={p}
                diagram={diagram}
                types={types}
                warnings={warnings.filter((w) => w.where === `traffic:${p.id}`)}
                onChange={(next) => edit((d) => void (d.traffic[i] = next))}
                onRemove={() => edit((d) => void d.traffic.splice(i, 1))}
                onPick={(apply) => setPicker({ label: "the traffic start", apply })}
              />
            ))}
            <button
              className="lv-add"
              onClick={() =>
                edit((d) => {
                  const node = diagram.nodes[0]?.id ?? "";
                  d.traffic.push({
                    id: uniqueSimId(
                      "traffic",
                      d.traffic.map((t) => t.id),
                    ),
                    node,
                    messageType: node ? suggestedMessageType(diagram, node) : undefined,
                    shape: defaultShape("burst"),
                  });
                })
              }
              data-testid="sim-panel-add-traffic"
            >
              <LiveIcon name="plus" size={13} /> Add traffic
            </button>
          </Section>

          <Disclosure
            id="timeline"
            title="Timeline"
            hint="Notes, outages and changes over time"
            count={sim.timeline?.length ?? 0}
            warn={warnings.some((w) => w.where.startsWith("timeline"))}
          >
            {(sim.timeline ?? []).map((step, i) => (
              <StepRow
                key={i}
                index={i}
                step={step}
                diagram={diagram}
                types={types}
                warnings={warnings.filter((w) => w.where === `timeline:${i}`)}
                onChange={(next) => edit((d) => void (d.timeline![i] = next))}
                onRemove={() => edit((d) => void d.timeline!.splice(i, 1))}
                onPick={(label, apply) => setPicker({ label, apply })}
              />
            ))}
            <select
              className="lv-add"
              value=""
              aria-label={translate("fault.addStep")}
              onChange={(event) => {
                const preset = event.target.value;
                if (!preset) return;
                edit((d) => {
                  const last = d.timeline?.at(-1)?.atMs ?? -2000;
                  const action: TimelineAction =
                    preset === "note"
                      ? { do: "note", text: "", focus: [] }
                      : {
                          do: "fault",
                          fault: drillFault(preset as DrillPreset, diagram),
                          drill: preset as DrillPreset,
                        };
                  (d.timeline ??= []).push({ atMs: last + 2000, action });
                });
              }}
              data-testid="sim-panel-add-step"
            >
              <option value="">{translate("fault.addStep")}</option>
              <option value="note">{translate("fault.note")}</option>
              <optgroup label={translate("fault.presets")}>
                {DRILL_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {drillName(preset)}
                  </option>
                ))}
              </optgroup>
            </select>
          </Disclosure>

          <Disclosure
            id="expectations"
            title="Expectations"
            hint="What must hold true"
            count={sim.expectations?.length ?? 0}
            warn={warnings.some((w) => w.where.startsWith("expectation"))}
          >
            {(sim.expectations ?? []).map((e, i) => (
              <ExpectationRow
                key={i}
                index={i}
                exp={e}
                diagram={diagram}
                live={state.simulation?.id === sim.id ? state.run?.expectations.find((x) => x.id === e.id) : undefined}
                warnings={warnings.filter((w) => w.where === `expectation:${e.id}`)}
                onChange={(next) => edit((d) => void (d.expectations![i] = next))}
                onRemove={() => edit((d) => void d.expectations!.splice(i, 1))}
              />
            ))}
            <button
              className="lv-add"
              onClick={() =>
                edit((d) => {
                  const list = (d.expectations ??= []);
                  const sink = lastNode(diagram);
                  list.push({
                    id: uniqueSimId(
                      "check",
                      list.map((x) => x.id),
                    ),
                    label: "Everything arrives",
                    metric: sink ? { node: sink, field: "processed" } : { system: "inSystem" },
                    op: sink ? ">=" : "==",
                    value: sink ? 1 : 0,
                    when: "end",
                  });
                })
              }
              data-testid="sim-panel-add-expectation"
            >
              <LiveIcon name="plus" size={13} /> Add expectation
            </button>
          </Disclosure>

          <Disclosure id="details" title="Details" hint="Description, seed and length">
            <Field label="Description">
              <textarea
                value={sim.description ?? ""}
                rows={2}
                placeholder="What question does this answer?"
                onChange={(e) => edit((d) => void (d.description = e.target.value || undefined))}
                data-testid="sim-panel-description"
                name="sim-description"
              />
            </Field>
            <div className="lv-row2">
              <Field label="Seed">
                <input
                  type="number"
                  value={sim.seed ?? ""}
                  onChange={(e) =>
                    edit((d) => void (d.seed = e.target.value === "" ? undefined : Math.floor(num(e.target.value))))
                  }
                  data-testid="sim-panel-seed"
                  name="sim-seed"
                />
              </Field>
              <Field label="Stop after (s)" hint="Empty: when it drains">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={sim.durationMs === undefined ? "" : sec(sim.durationMs)}
                  onChange={(e) =>
                    edit((d) => void (d.durationMs = e.target.value === "" ? undefined : ms(num(e.target.value))))
                  }
                  data-testid="sim-panel-duration"
                  name="sim-duration"
                />
              </Field>
            </div>
            {!saved && (
              <Field label="Id">
                <input
                  className="mono"
                  value={sim.id}
                  onChange={(e) => edit((d) => void (d.id = e.target.value.replace(/[^a-z0-9-]/gi, "-").toLowerCase()))}
                  data-testid="sim-panel-id"
                  name="sim-id"
                />
              </Field>
            )}
          </Disclosure>

          {warnings.length > 0 && (
            <ul className="lv-warnings" data-testid="sim-panel-warnings">
              {warnings.map((w, i) => (
                <li key={i}>
                  <LiveIcon name="warn" size={13} /> {w.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sim && (
        <footer className="lv-panel-foot">
          {saved && (
            <button
              className="btn lv-danger"
              onClick={() => {
                onDelete(sim.id);
                setSim(null);
              }}
              data-testid="sim-panel-delete"
              title="Delete this simulation (undoable)"
            >
              <LiveIcon name="trash" size={13} />
            </button>
          )}
          <span className="lv-grow" />
          <button
            className="btn"
            onClick={() => onRun(sim)}
            data-testid="sim-panel-run"
            title={running ? "Restart this simulation" : "Play this simulation now"}
          >
            <LiveIcon name="play" size={11} /> {running ? "Run again" : "Run"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSave(sim)}
            disabled={!dirty || !sim.title.trim() || !sim.id}
            data-testid="sim-panel-save"
          >
            <LiveIcon name="save" size={13} /> Save
          </button>
        </footer>
      )}
    </aside>
  );
}

function lastNode(d: DiagramFile): string | undefined {
  const edges = flowEdges(d.edges);
  const from = new Set(edges.map((e) => e.from));
  return d.nodes.find((n) => !from.has(n.id) && edges.some((e) => e.to === n.id))?.id ?? d.nodes.at(-1)?.id;
}

/** While a picker is active, the next click on a diagram node chooses it (instead of selecting it). */
function usePickNode(picker: Picker, done: () => void) {
  const store = useStoreApi();
  const ref = useRef({ picker, done });
  useLayoutEffect(() => {
    ref.current = { picker, done };
  });
  useEffect(() => {
    const root = store.getState().domNode;
    if (!picker || !root) return;
    root.dataset.livePicking = "1";
    const onClick = (e: MouseEvent) => {
      const el =
        e.target instanceof Element ? e.target.closest<HTMLElement>(".react-flow__node-diagram[data-id]") : null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current.picker?.apply(el.dataset.id!);
      ref.current.done();
    };
    root.addEventListener("click", onClick, true);
    return () => {
      delete root.dataset.livePicking;
      root.removeEventListener("click", onClick, true);
    };
  }, [picker, store]);
}

function SimList({
  onEdit,
  onNew,
  onRun,
  running,
}: {
  onEdit: (s: Simulation) => void;
  onNew: () => void;
  onRun: (s: Simulation) => void;
  running: string | null;
}) {
  const ui = useLive();
  const list = [...ui.simulations];
  if (ui.draft && !list.some((s) => s.id === ui.draft!.id)) list.push(ui.draft);
  return (
    <div className="lv-panel-body" data-testid="sim-panel-list">
      {list.length === 0 && (
        <p className="lv-empty">
          No simulations yet. Right-click a node and choose <b>Start a storm here…</b>, or create one from scratch.
        </p>
      )}
      {list.map((s) => (
        <div
          key={s.id}
          className={`lv-sim-item${running === s.id ? " is-running" : ""}`}
          data-testid={`sim-panel-item-${s.id}`}
        >
          <button className="lv-sim-main" onClick={() => onEdit(s)} data-testid={`sim-panel-edit-${s.id}`}>
            <strong>
              {s.title}
              {ui.draft?.id === s.id && <span className="lv-dirty">unsaved</span>}
            </strong>
            {s.description && <span>{s.description}</span>}
            <small className="mono">
              {s.traffic.length} traffic · {s.timeline?.length ?? 0} steps · {s.expectations?.length ?? 0} checks
            </small>
          </button>
          <button
            className="lv-btn"
            onClick={() => onRun(s)}
            title="Run"
            aria-label={`Run ${s.title}`}
            data-testid={`sim-panel-run-${s.id}`}
          >
            <LiveIcon name="play" size={12} />
          </button>
        </div>
      ))}
      <button className="lv-add" onClick={onNew} data-testid="sim-panel-new">
        <LiveIcon name="plus" size={13} /> New simulation
      </button>
    </div>
  );
}

function Section({
  title,
  count,
  warn,
  children,
}: {
  title: string;
  count?: number;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="lv-section">
      <h4>
        {title}
        {count !== undefined && <span>{count}</span>}
        {warn && <LiveIcon name="warn" size={12} className="lv-warn-icon" />}
      </h4>
      {children}
    </section>
  );
}

/** A collapsible group, closed by default: the common path never needs it. */
function Disclosure({
  id,
  title,
  hint,
  count,
  warn,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  count?: number;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="lv-disclosure" data-testid={`sim-panel-section-${id}`}>
      <summary data-testid={`sim-panel-section-${id}-toggle`}>
        <LiveIcon name="chevron" size={12} className="lv-disclosure-chevron" />
        <span className="lv-disclosure-title">{title}</span>
        {count !== undefined && count > 0 && <span className="lv-disclosure-count">{count}</span>}
        {warn && <LiveIcon name="warn" size={12} className="lv-warn-icon" />}
        {hint && <small>{hint}</small>}
      </summary>
      <div className="lv-disclosure-body">{children}</div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="lv-field">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

function NodeSelect({
  value,
  diagram,
  onChange,
  onPick,
  testId,
  allowEmpty,
  label,
}: {
  value: string;
  diagram: DiagramFile;
  onChange: (id: string) => void;
  onPick?: () => void;
  testId: string;
  allowEmpty?: boolean;
  label?: string;
}) {
  const missing = !!value && !diagram.nodes.some((n) => n.id === value);
  return (
    <div className="lv-node-select">
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        name={testId}
        className={missing ? "is-missing" : undefined}
      >
        {(allowEmpty || !value) && <option value="">Choose a node…</option>}
        {missing && <option value={value}>{value} (missing)</option>}
        {diagram.nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.label || n.id}
          </option>
        ))}
      </select>
      {onPick && (
        <button
          type="button"
          className="lv-btn"
          onClick={onPick}
          title="Pick on the canvas"
          aria-label="Pick on the canvas"
          data-testid={`${testId}-pick`}
        >
          <LiveIcon name="target" size={13} />
        </button>
      )}
    </div>
  );
}

function Warnings({ list }: { list: SimWarning[] }) {
  if (!list.length) return null;
  return (
    <div className="lv-inline-warn">
      {list.map((w, i) => (
        <span key={i}>
          <LiveIcon name="warn" size={12} /> {w.text}
        </span>
      ))}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  testId,
  step = 1,
  min = 0,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  testId: string;
  step?: number;
  min?: number;
  unit?: string;
}) {
  return (
    <Field label={unit ? `${label} (${unit})` : label}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => onChange(num(e.target.value))}
        data-testid={testId}
        name={testId}
      />
    </Field>
  );
}

interface TrafficCardProps {
  index: number;
  profile: TrafficProfile;
  diagram: DiagramFile;
  types: string[];
  warnings: SimWarning[];
  onChange: (p: TrafficProfile) => void;
  onRemove: () => void;
  onPick: (apply: (id: string) => void) => void;
}

function TrafficCard({ index, profile: p, diagram, types, warnings, onChange, onRemove, onPick }: TrafficCardProps) {
  const t = `sim-panel-traffic-${index}`;
  const set = (patch: Partial<TrafficProfile>) => onChange({ ...p, ...patch });
  const shape = (patch: Partial<TrafficShape>) => onChange({ ...p, shape: { ...p.shape, ...patch } as TrafficShape });
  const s = p.shape;
  return (
    <div className="lv-card" data-testid={t}>
      <div className="lv-card-head">
        <input
          className="lv-card-title"
          value={p.label ?? ""}
          placeholder={`Traffic ${index + 1}`}
          onChange={(e) => set({ label: e.target.value || undefined })}
          data-testid={`${t}-label`}
          name={`${t}-label`}
        />
        <button className="lv-btn" onClick={onRemove} aria-label="Remove traffic" data-testid={`${t}-remove`}>
          <LiveIcon name="trash" size={13} />
        </button>
      </div>
      <div className="lv-row2">
        <Field label="Starts at">
          <NodeSelect
            value={p.node}
            diagram={diagram}
            testId={`${t}-node`}
            onChange={(node) => set({ node })}
            onPick={() => onPick((node) => set({ node }))}
          />
        </Field>
        <Field label="Message type">
          <input
            list={`${t}-types`}
            className="mono"
            value={p.messageType ?? ""}
            placeholder="default"
            onChange={(e) => set({ messageType: e.target.value || undefined })}
            data-testid={`${t}-type`}
            name={`${t}-type`}
          />
          <datalist id={`${t}-types`}>
            {types.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
      </div>
      {s.kind === "burst" ? (
        <div className="lv-row2">
          <NumberField
            label="Messages"
            value={s.count}
            min={1}
            onChange={(v) => shape({ count: Math.floor(v) })}
            testId={`${t}-count`}
          />
          <NumberField
            label="Over"
            unit="s"
            step={0.5}
            value={sec(s.spreadMs)}
            onChange={(v) => shape({ spreadMs: ms(v) })}
            testId={`${t}-spread`}
          />
        </div>
      ) : (
        <p className="lv-summary" data-testid={`${t}-summary`}>
          {shapeSummary(s)}
        </p>
      )}
      <details className="lv-advanced" open={s.kind !== "burst" || undefined} data-testid={`${t}-advanced`}>
        <summary data-testid={`${t}-advanced-toggle`}>
          <LiveIcon name="chevron" size={11} className="lv-disclosure-chevron" />
          Shape and timing
        </summary>
        <div className="lv-seg" role="radiogroup" aria-label="Shape">
          {SHAPES.map((k) => (
            <button
              key={k.kind}
              role="radio"
              aria-checked={s.kind === k.kind}
              className={s.kind === k.kind ? "is-on" : undefined}
              onClick={() => s.kind !== k.kind && set({ shape: defaultShape(k.kind, s) })}
              data-testid={`${t}-kind-${k.kind}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="lv-shape">
          {s.kind === "burst" && (
            <>
              <NumberField
                label="At"
                unit="s"
                step={0.5}
                value={sec(s.atMs)}
                onChange={(v) => shape({ atMs: ms(v) })}
                testId={`${t}-at`}
              />
            </>
          )}
          {s.kind === "constant" && (
            <>
              <NumberField
                label="Rate"
                unit="/s"
                value={s.ratePerSec}
                onChange={(v) => shape({ ratePerSec: v })}
                testId={`${t}-rate`}
              />
              <NumberField
                label="From"
                unit="s"
                step={0.5}
                value={sec(s.fromMs)}
                onChange={(v) => shape({ fromMs: ms(v) })}
                testId={`${t}-from`}
              />
              <NumberField
                label="For"
                unit="s"
                step={0.5}
                value={sec(s.durationMs)}
                onChange={(v) => shape({ durationMs: ms(v) })}
                testId={`${t}-duration`}
              />
            </>
          )}
          {s.kind === "spike" && (
            <>
              <NumberField
                label="Base"
                unit="/s"
                value={s.baseRate}
                onChange={(v) => shape({ baseRate: v })}
                testId={`${t}-base`}
              />
              <NumberField
                label="Peak"
                unit="/s"
                value={s.peakRate}
                onChange={(v) => shape({ peakRate: v })}
                testId={`${t}-peak`}
              />
              <NumberField
                label="Peak at"
                unit="s"
                step={0.5}
                value={sec(s.atMs)}
                onChange={(v) => shape({ atMs: ms(v) })}
                testId={`${t}-at`}
              />
              <NumberField
                label="Peak for"
                unit="s"
                step={0.5}
                value={sec(s.peakMs)}
                onChange={(v) => shape({ peakMs: ms(v) })}
                testId={`${t}-peak-for`}
              />
              <NumberField
                label="Total"
                unit="s"
                step={0.5}
                value={sec(s.durationMs)}
                onChange={(v) => shape({ durationMs: ms(v) })}
                testId={`${t}-duration`}
              />
            </>
          )}
          {s.kind === "ramp" && (
            <>
              <NumberField
                label="Start rate"
                unit="/s"
                value={s.startRate ?? 0}
                onChange={(v) => shape({ startRate: v })}
                testId={`${t}-start-rate`}
              />
              <NumberField
                label="From"
                unit="s"
                step={0.5}
                value={sec(s.fromMs)}
                onChange={(v) => shape({ fromMs: ms(v) })}
                testId={`${t}-from`}
              />
              <div className="lv-stages">
                {s.stages.map((st, i) => (
                  <div className="lv-stage" key={i}>
                    <span className="mono">{i + 1}</span>
                    <input
                      type="number"
                      value={sec(st.durationMs)}
                      step={0.5}
                      min={0}
                      aria-label="Stage seconds"
                      onChange={(e) =>
                        shape({
                          stages: s.stages.map((x, j) => (j === i ? { ...x, durationMs: ms(num(e.target.value)) } : x)),
                        })
                      }
                      data-testid={`${t}-stage-${i}-duration`}
                      name={`${t}-stage-${i}-duration`}
                    />
                    <small>s to</small>
                    <input
                      type="number"
                      value={st.targetRate}
                      min={0}
                      aria-label="Target rate"
                      onChange={(e) =>
                        shape({
                          stages: s.stages.map((x, j) => (j === i ? { ...x, targetRate: num(e.target.value) } : x)),
                        })
                      }
                      data-testid={`${t}-stage-${i}-rate`}
                      name={`${t}-stage-${i}-rate`}
                    />
                    <small>/s</small>
                    <button
                      className="lv-btn"
                      onClick={() => shape({ stages: s.stages.filter((_, j) => j !== i) })}
                      aria-label="Remove stage"
                      disabled={s.stages.length < 2}
                    >
                      <LiveIcon name="close" size={11} />
                    </button>
                  </div>
                ))}
                <button
                  className="link-btn"
                  onClick={() =>
                    shape({
                      stages: [...s.stages, { durationMs: 2000, targetRate: s.stages.at(-1)?.targetRate ?? 10 }],
                    })
                  }
                  data-testid={`${t}-add-stage`}
                >
                  + Stage
                </button>
              </div>
            </>
          )}
        </div>
        <Sparkline shape={s} testId={`${t}-sparkline`} />
      </details>
      <Warnings list={warnings} />
    </div>
  );
}

/** One line describing a non-burst shape, e.g. "20/s for 5 s from 0 s". */
function shapeSummary(s: TrafficShape): string {
  switch (s.kind) {
    case "burst":
      return `${s.count} messages over ${formatSeconds(s.spreadMs ?? 0)}`;
    case "constant":
      return `${s.ratePerSec}/s for ${formatSeconds(s.durationMs)}, from ${formatSeconds(s.fromMs ?? 0)}`;
    case "ramp":
      return `Ramps from ${s.startRate ?? 0}/s through ${s.stages.map((x) => `${x.targetRate}/s`).join(" → ")}`;
    case "spike":
      return `${s.baseRate}/s with a ${s.peakRate}/s spike at ${formatSeconds(s.atMs)}`;
  }
}

interface StepRowProps {
  index: number;
  step: TimelineStep;
  diagram: DiagramFile;
  types: string[];
  warnings: SimWarning[];
  onChange: (s: TimelineStep) => void;
  onRemove: () => void;
  onPick: (label: string, apply: (id: string) => void) => void;
}

function StepRow({ index, step, diagram, types, warnings, onChange, onRemove, onPick }: StepRowProps) {
  const t = `sim-panel-step-${index}`;
  const a = step.action;
  const setAction = (action: TimelineAction) => onChange({ ...step, action });
  const switchTo = (kind: TimelineAction["do"]) => {
    const node = "node" in a ? a.node : ((a.do === "note" ? a.focus?.[0] : undefined) ?? diagram.nodes[0]?.id ?? "");
    if (kind === "fault") setAction({ do: "fault", fault: defaultFault("boundary", diagram) });
    if (kind === "note") setAction({ do: "note", text: "", focus: node ? [node] : [] });
    if (kind === "status") setAction({ do: "status", node, status: "down" });
    if (kind === "props") setAction({ do: "props", node, props: { latencyMs: 1000 } });
    if (kind === "inject")
      setAction({ do: "inject", node, count: 10, messageType: suggestedMessageType(diagram, node) });
    if (kind === "trace") setAction({ do: "trace", node });
  };
  const labels = new Map(diagram.nodes.map((n) => [n.id, n.label || n.id]));
  const propKey = a.do === "props" ? (Object.keys(a.props)[0] ?? "latencyMs") : "latencyMs";

  return (
    <div className={`lv-card lv-step is-${a.do}`} data-testid={t}>
      <div className="lv-step-head">
        <input
          type="number"
          className="lv-step-time"
          step={0.5}
          min={0}
          value={sec(step.atMs)}
          onChange={(e) => onChange({ ...step, atMs: ms(num(e.target.value)) })}
          aria-label="Time (s)"
          data-testid={`${t}-time`}
          name={`${t}-time`}
        />
        <small>s</small>
        <select
          value={a.do}
          aria-label="Action"
          onChange={(e) => switchTo(e.target.value as TimelineAction["do"])}
          data-testid={`${t}-action`}
          name={`${t}-action`}
        >
          <option value="fault">{translate("fault.action")}</option>
          {ACTIONS.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
        <span className="lv-grow" />
        <button className="lv-btn" onClick={onRemove} aria-label="Remove step" data-testid={`${t}-remove`}>
          <LiveIcon name="trash" size={13} />
        </button>
      </div>
      {a.do === "fault" ? (
        <>
          {a.drill && <small>{translate("fault.drill", { name: drillName(a.drill) })}</small>}
          <FaultStep
            fault={a.fault}
            diagram={diagram}
            testId={t}
            onChange={(fault) =>
              setAction({ do: "fault", fault, ...(fault.kind === a.fault.kind && a.drill ? { drill: a.drill } : {}) })
            }
          />
        </>
      ) : a.do === "note" ? (
        <>
          <textarea
            rows={2}
            value={a.text}
            placeholder="What should the audience notice?"
            onChange={(e) => setAction({ ...a, text: e.target.value })}
            data-testid={`${t}-text`}
            name={`${t}-text`}
          />
          <div className="lv-focus">
            {(a.focus ?? []).map((id) => (
              <span key={id} className={`lv-focus-chip${labels.has(id) ? "" : " is-missing"}`}>
                {labels.get(id) ?? `${id} (missing)`}
                <button
                  onClick={() => setAction({ ...a, focus: (a.focus ?? []).filter((x) => x !== id) })}
                  aria-label={`Remove ${id}`}
                >
                  <LiveIcon name="close" size={10} />
                </button>
              </span>
            ))}
            <select
              value=""
              onChange={(e) =>
                e.target.value && setAction({ ...a, focus: [...new Set([...(a.focus ?? []), e.target.value])] })
              }
              data-testid={`${t}-focus`}
              name={`${t}-focus`}
              aria-label="Add a focus node"
            >
              <option value="">+ Focus…</option>
              {diagram.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || n.id}
                </option>
              ))}
            </select>
            <button
              className="lv-btn"
              onClick={() =>
                onPick("the note's focus", (id) => setAction({ ...a, focus: [...new Set([...(a.focus ?? []), id])] }))
              }
              aria-label="Pick focus on the canvas"
              title="Pick on the canvas"
            >
              <LiveIcon name="target" size={13} />
            </button>
          </div>
          <label className="lv-check">
            <input
              type="checkbox"
              checked={!!a.pause}
              onChange={(e) => setAction({ ...a, pause: e.target.checked || undefined })}
              data-testid={`${t}-pause`}
              name={`${t}-pause`}
            />
            <span>Pause until the presenter continues</span>
          </label>
        </>
      ) : (
        <div className="lv-step-body">
          <NodeSelect
            value={a.node}
            label="Target node"
            diagram={diagram}
            testId={`${t}-node`}
            onChange={(node) => setAction({ ...a, node })}
            onPick={() => onPick("this step", (node) => setAction({ ...a, node }))}
          />
          {a.do === "status" && (
            <select
              value={a.status}
              aria-label="Status"
              onChange={(e) => setAction({ ...a, status: e.target.value as "up" | "paused" | "down" })}
              data-testid={`${t}-status`}
              name={`${t}-status`}
            >
              <option value="down">down</option>
              <option value="paused">paused</option>
              <option value="up">up</option>
            </select>
          )}
          {a.do === "props" && (
            <div className="lv-inline">
              <select
                value={propKey}
                aria-label="Property"
                onChange={(e) => {
                  const v = a.props[propKey];
                  const rest = Object.fromEntries(Object.entries(a.props).filter(([key]) => key !== propKey));
                  setAction({ ...a, props: { [e.target.value]: v, ...rest } });
                }}
                data-testid={`${t}-prop`}
                name={`${t}-prop`}
              >
                {PROP_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="any"
                value={Number(a.props[propKey] ?? 0)}
                onChange={(e) => setAction({ ...a, props: { ...a.props, [propKey]: num(e.target.value) } })}
                data-testid={`${t}-value`}
                name={`${t}-value`}
                aria-label="Value"
              />
            </div>
          )}
          {a.do === "inject" && (
            <div className="lv-inline">
              <input
                type="number"
                min={1}
                value={a.count}
                onChange={(e) => setAction({ ...a, count: Math.max(1, Math.floor(num(e.target.value))) })}
                aria-label="Messages"
                data-testid={`${t}-count`}
                name={`${t}-count`}
              />
              <input
                list={`${t}-types`}
                className="mono"
                value={a.messageType ?? ""}
                placeholder="type"
                onChange={(e) => setAction({ ...a, messageType: e.target.value || undefined })}
                aria-label="Message type"
                data-testid={`${t}-type`}
                name={`${t}-type`}
              />
              <datalist id={`${t}-types`}>
                {types.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </div>
          )}
        </div>
      )}
      <Warnings list={warnings} />
    </div>
  );
}

interface ExpectationRowProps {
  index: number;
  exp: Expectation;
  diagram: DiagramFile;
  live?: { status: string; value: number };
  warnings: SimWarning[];
  onChange: (e: Expectation) => void;
  onRemove: () => void;
}

function ExpectationRow({ index, exp, diagram, live, warnings, onChange, onRemove }: ExpectationRowProps) {
  const t = `sim-panel-expectation-${index}`;
  const m = exp.metric;
  const isSystem = "system" in m;
  const groups = !isSystem && m.field === "lag" ? groupsOf(diagram, m.node) : [];
  return (
    <div className="lv-card lv-exp-row" data-testid={t}>
      <div className="lv-card-head">
        <input
          className="lv-card-title"
          value={exp.label}
          placeholder="What must hold?"
          onChange={(e) => onChange({ ...exp, label: e.target.value })}
          data-testid={`${t}-label`}
          name={`${t}-label`}
        />
        {live && (
          <span className={`lv-exp is-${live.status} is-small`} title="Live value from the current run">
            {Number.isInteger(live.value) ? live.value : live.value.toFixed(1)}
          </span>
        )}
        <button className="lv-btn" onClick={onRemove} aria-label="Remove expectation" data-testid={`${t}-remove`}>
          <LiveIcon name="trash" size={13} />
        </button>
      </div>
      <div className="lv-inline">
        <select
          value={isSystem ? "__system" : m.node}
          onChange={(e) =>
            onChange({
              ...exp,
              metric:
                e.target.value === "__system"
                  ? { system: "inSystem" }
                  : { node: e.target.value, field: isSystem ? "processed" : m.field },
            })
          }
          data-testid={`${t}-node`}
          name={`${t}-node`}
          aria-label="Metric node"
        >
          <option value="__system">Whole system</option>
          {!isSystem && !diagram.nodes.some((n) => n.id === m.node) && (
            <option value={m.node}>{m.node} (missing)</option>
          )}
          {diagram.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label || n.id}
            </option>
          ))}
        </select>
        {isSystem ? (
          <span className="lv-muted">in system</span>
        ) : (
          <select
            value={m.field}
            onChange={(e) => onChange({ ...exp, metric: { node: m.node, field: e.target.value as MetricField } })}
            data-testid={`${t}-field`}
            name={`${t}-field`}
            aria-label="Metric"
          >
            {FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.value === "rejected" ? translate("admission.rejected") : f.label}
              </option>
            ))}
          </select>
        )}
        {groups.length > 1 && !isSystem && (
          <select
            value={m.group ?? ""}
            onChange={(e) => onChange({ ...exp, metric: { ...m, group: e.target.value || undefined } })}
            data-testid={`${t}-group`}
            name={`${t}-group`}
            aria-label="Consumer group"
          >
            <option value="">max of groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="lv-inline">
        <select
          value={exp.op}
          onChange={(e) => onChange({ ...exp, op: e.target.value as Expectation["op"] })}
          data-testid={`${t}-op`}
          name={`${t}-op`}
          aria-label="Comparison"
        >
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="any"
          value={exp.value}
          onChange={(e) => onChange({ ...exp, value: num(e.target.value) })}
          data-testid={`${t}-value`}
          name={`${t}-value`}
          aria-label="Value"
        />
        <select
          value={exp.when ?? "end"}
          onChange={(e) =>
            onChange({
              ...exp,
              when: e.target.value as Expectation["when"],
              atMs: e.target.value === "at" ? (exp.atMs ?? 5000) : undefined,
            })
          }
          data-testid={`${t}-when`}
          name={`${t}-when`}
          aria-label="When"
        >
          {WHENS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
        {exp.when === "at" && (
          <>
            <input
              type="number"
              step={0.5}
              min={0}
              value={sec(exp.atMs)}
              onChange={(e) => onChange({ ...exp, atMs: ms(num(e.target.value)) })}
              aria-label="At (s)"
              data-testid={`${t}-at`}
              name={`${t}-at`}
            />
            <small>{formatSeconds(exp.atMs ?? 0)}</small>
          </>
        )}
      </div>
      <Warnings list={warnings} />
    </div>
  );
}

/** Consumer-group names on a node's outgoing edges (edge id when no group is set). */
function groupsOf(d: DiagramFile, nodeId: string): string[] {
  return [
    ...new Set(
      flowEdges(d.edges)
        .filter((e) => e.from === nodeId)
        .map((e) => (typeof e.props?.group === "string" ? e.props.group : e.id)),
    ),
  ];
}
