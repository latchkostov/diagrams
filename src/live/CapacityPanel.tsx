import { revisionAtLeast } from "../model/revisions";
import { replicaRange } from "../model/autoscaling";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { DiagramFile, DiagramNode, Simulation } from "../model/types";
import { t, useLocale } from "../i18n";
import { brokerSpec, type BrokerSpec } from "../model/brokers";
import { assignmentLabel } from "../stencils/brokerVocabulary";
import { stencilRole } from "../stencils/roles";
import { autoScale } from "../sim/scale";
import { LIMITS, SIM_LIMITS } from "../interop/native";
import type { LiveController } from "./controller";
import {
  applyPreset,
  baseProps,
  CAPACITY_STOPS,
  emptyInputs,
  entryCandidates,
  entryRates,
  formatMultiplier,
  formatRateInput,
  formatUtilization,
  freePlayScale,
  hasInputs,
  isPresetActive,
  nearestStop,
  parseRate,
  partitionsNotes,
  PRESETS,
  RATE_STEPS,
  rateFromSlider,
  rateSliderMax,
  scaleOptions,
  selectRows,
  sliderFromRate,
  TRAFFIC_STOPS,
  type CapacityFix,
  type CapacityView,
  type LiveInputs,
  type NodeHeat,
} from "./capacityModel";
import { BottleneckCallout } from "./CapacityLayer";
import { formatRate, formatScale } from "./format";
import { LiveIcon } from "./icons";
import { usePanelEscape } from "./usePanelEscape";
import type { ElementHandle } from "../canvas/interaction/types";

const FieldValidation = createContext<(id: string, valid: boolean) => void>(() => {});

interface Props {
  opener?: ElementHandle | null;
  controller: LiveController;
  diagram: DiagramFile;
  base: Simulation | null;
  running: Simulation | null;
  inputs: LiveInputs;
  scale: number;
  error?: string | null;
  view: CapacityView;
  onClose: () => void;
  /** Undoable fix; omitted where nothing can be edited. */
  onApplyFix?: (fix: CapacityFix) => void;
  /** Writes the inputs (simulation or diagram); omitted where nothing can be saved (the Lab). */
  onSave?: () => void;
  /** Adds an upstream entry point in front of a node (one undoable edit); omitted where nothing can be edited. */
  onAddEntry?: (nodeId: string) => void;
  /** "Nobody reads X" › Add a consumer. */
  onAddConsumer?: (brokerId: string) => void;
  onChange?: () => void;
  disabledHint?: string;
}

/**
 * "Inputs & capacity": one place to say how much traffic enters, how big each service is and how
 * many partitions each topic has, generated from the diagram. Everything applies to the running
 * view at once; Save writes it (undoably) to the simulation, or to the diagram in free play.
 */
export const CapacityPanel = memo(function CapacityPanel({
  controller: c,
  diagram,
  base,
  running,
  inputs,
  scale,
  error,
  view,
  onClose,
  onApplyFix,
  onSave,
  onChange,
  onAddEntry,
  onAddConsumer,
  disabledHint,
  opener,
}: Props) {
  const locale = useLocale();
  const [inputError, setInputError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [heldRows, setHeldRows] = useState<ReturnType<typeof selectRows> | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(new Set());
  const validity = useCallback(
    (id: string, valid: boolean) =>
      setInvalidFields((before) => {
        if (before.has(id) === !valid) return before;
        const next = new Set(before);
        if (valid) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  usePanelEscape(onClose, undefined, opener);

  const set = (next: LiveInputs) => {
    if (disabledHint) return;
    try {
      c.setInputs(next);
      setInputError(null);
      onChange?.();
    } catch (error) {
      setInputError(error instanceof Error ? error.message : String(error));
    }
  };
  const setProp = (id: string, key: string, value: unknown) =>
    set({ ...inputs, props: { ...inputs.props, [id]: { ...inputs.props[id], [key]: value } } });
  const rates = useMemo(() => entryRates(diagram, base, inputs), [diagram, base, inputs]);
  const selectedRows = useMemo(
    () => selectRows(diagram, view, rates.keys(), { showAll, editing }),
    [diagram, view, rates, showAll, editing],
  );
  const byId = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram]);
  const rows = useMemo(() => {
    if (!editing || !heldRows || !byId.has(editing)) return selectedRows;
    return {
      ...heldRows,
      entries: heldRows.entries.filter((id) => byId.has(id)),
      services: heldRows.services.filter((id) => byId.has(id)),
      brokers: heldRows.brokers.filter((id) => byId.has(id)),
    };
  }, [editing, heldRows, byId, selectedRows]);
  const props = (n: DiagramNode) => baseProps(diagram, n, base, inputs.props[n.id]);
  // t() reads the language store; retain the language with the cached translated snapshot.
  const { value: notes } = useMemo(
    () => ({ locale, value: partitionsNotes(diagram, base, inputs) }),
    [diagram, base, inputs, locale],
  );
  const partitioned = useMemo(
    () =>
      diagram.nodes
        .map((n) => brokerSpec(n.stencil, stencilRole(n.stencil), diagram.planning))
        .filter((spec) => spec?.partitioned),
    [diagram.nodes, diagram.planning],
  );
  const assignmentLabels = [...new Set(partitioned.map(assignmentLabel))].join(" / ");
  const traffic = inputs.traffic ?? base?.multipliers?.traffic ?? 1;
  const capacity = inputs.capacity ?? base?.multipliers?.capacity ?? 1;
  const dirty = hasInputs(inputs) || invalidFields.size > 0;

  return (
    <FieldValidation.Provider value={validity}>
      <aside
        className="lv-panel cap-panel"
        data-testid="capacity-panel"
        data-editor-overlay
        aria-label="Inputs and capacity"
        onFocusCapture={(e) => {
          const row = e.target.closest<HTMLElement>("[data-capacity-node]");
          if (row) {
            setEditing(row.dataset.capacityNode ?? null);
            setHeldRows(rows);
          }
        }}
        onBlurCapture={(e) => {
          if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setEditing(null);
          else if (e.relatedTarget instanceof Element && !e.relatedTarget.closest("[data-capacity-node]"))
            setEditing(null);
        }}
      >
        <header className="lv-panel-head">
          <LiveIcon name="gauge" size={16} />
          <strong data-testid="capacity-heading">Inputs &amp; capacity</strong>
          {dirty && (
            <span className="lv-dirty" data-testid="capacity-dirty">
              unsaved
            </span>
          )}
          <button className="lv-btn lv-panel-close" onClick={onClose} aria-label="Close" data-testid="capacity-close">
            <LiveIcon name="close" size={13} />
          </button>
        </header>

        <div className="lv-panel-body cap-body">
          <p className="cap-context" data-testid="capacity-context">
            {disabledHint ? (
              disabledHint
            ) : base ? (
              <>
                For <b>{base.title}</b>. Changes apply now; save to keep them.
              </>
            ) : (
              "Free play: rates and sizes from the diagram. Changes apply now; save to keep them."
            )}
          </p>

          {rates.size === 0 ? (
            <NoEntryPoints diagram={diagram} onAdd={onAddEntry} disabledHint={disabledHint} />
          ) : (
            <BottleneckCallout
              view={view}
              onApply={onApplyFix}
              disabledHint={disabledHint}
              onAddConsumer={onAddConsumer}
            />
          )}

          <fieldset className="cap-edit-fields" disabled={!!disabledHint} title={disabledHint}>
            <section className="cap-section" aria-labelledby="cap-whatif">
              <h4 id="cap-whatif">What if</h4>
              <Multiplier
                id="capacity-traffic-mult"
                label="Traffic"
                hint="Every entry rate at once"
                stops={TRAFFIC_STOPS}
                value={traffic}
                onChange={(v) => set({ ...inputs, traffic: v })}
              />
              <Multiplier
                id="capacity-capacity-mult"
                label="Capacity"
                hint="Every service's replicas at once"
                stops={CAPACITY_STOPS}
                value={capacity}
                onChange={(v) => set({ ...inputs, capacity: v })}
              />
              <div className="cap-presets" role="group" aria-label="Presets">
                {PRESETS.filter((p) => p.id !== "double-partitions" || partitioned.length > 0).map((p) => {
                  const on = isPresetActive(p.id, inputs, diagram, base);
                  return (
                    <button
                      key={p.id}
                      className={`cap-preset${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      title={
                        revisionAtLeast(diagram.planning?.revision, "p2")
                          ? p.id === "double-partitions"
                            ? `2 × ${assignmentLabels}`
                            : p.id === "normal"
                              ? undefined
                              : p.hint
                          : p.hint
                      }
                      onClick={() => set(applyPreset(p.id, inputs, diagram, base))}
                      data-testid={`capacity-preset-${p.id}`}
                    >
                      {p.id === "double-partitions" && revisionAtLeast(diagram.planning?.revision, "p2")
                        ? `2 × ${assignmentLabels}`
                        : p.label}
                      {p.id === "black-friday" && <small>5×</small>}
                    </button>
                  );
                })}
              </div>
            </section>

            {rows.entries.length > 0 && (
              <Group title="Entry points" hint="How many messages enter here per second" count={rows.entries.length}>
                {rows.entries.map((id) => (
                  <EntryRow
                    key={`${id}:${resetVersion}`}
                    node={byId.get(id)!}
                    rate={rates.get(id) ?? 0}
                    traffic={traffic}
                    onValidity={(valid) => validity(`capacity-rate-${id}`, valid)}
                    onRate={(rate) => set({ ...inputs, rates: { ...inputs.rates, [id]: rate } })}
                  />
                ))}
              </Group>
            )}

            {rows.services.length > 0 && (
              <Group title="Services" hint="Replicas are pods; latency is the time to handle one message">
                {rows.services.map((id) => (
                  <ServiceRow
                    key={`${id}:${resetVersion}`}
                    node={byId.get(id)!}
                    heat={view.nodes[id]}
                    props={props(byId.get(id)!)}
                    capacity={capacity}
                    onProp={(key, value) => setProp(id, key, value)}
                  />
                ))}
              </Group>
            )}

            {rows.brokers.length > 0 && (
              <Group title="Topics & queues" hint={t("broker.groupHint")}>
                {rows.brokers.map((id) => (
                  <BrokerRow
                    key={`${id}:${resetVersion}`}
                    node={byId.get(id)!}
                    heat={view.nodes[id]}
                    partitions={props(byId.get(id)!).partitions}
                    broker={props(byId.get(id)!).broker}
                    note={notes.get(id)}
                    onPartitions={(n) => setProp(id, "partitions", n)}
                  />
                ))}
              </Group>
            )}
          </fieldset>
          {(rows.hidden > 0 || showAll) && (
            <button
              className="lv-add cap-show-all"
              onClick={() => setShowAll((s) => !s)}
              data-testid="capacity-show-all"
            >
              <LiveIcon name="chevron" size={12} className={showAll ? "lv-rot180" : undefined} />
              {showAll ? "Show the busiest only" : `Show all (${rows.hidden} more)`}
            </button>
          )}

          <fieldset className="cap-edit-fields" disabled={!!disabledHint} title={disabledHint}>
            <ScaleIndicator
              scale={scale}
              running={running}
              diagram={diagram}
              base={base}
              inputs={inputs}
              onScale={(scale) => set({ ...inputs, scale })}
            />
          </fieldset>

          <p className="cap-footnote">
            Planning estimate at peak rates. Gateways and databases aren&apos;t capacity-limited in this simulation.
          </p>
        </div>

        {inputError && (
          <p className="cap-error" role="alert" data-testid="capacity-input-error">
            {inputError}
          </p>
        )}
        {error && (
          <p className="cap-error" role="alert" data-testid="capacity-save-error">
            {error}
          </p>
        )}
        <footer className="lv-panel-foot">
          <button
            className="btn"
            onClick={() => {
              setInvalidFields(new Set());
              setResetVersion((v) => v + 1);
              set(emptyInputs());
            }}
            disabled={!!disabledHint || !dirty}
            data-testid="capacity-reset"
            title={disabledHint ?? "Back to the saved values"}
          >
            Reset
          </button>
          <span className="lv-grow" />
          {onSave && (
            <button
              className="btn btn-primary"
              onClick={onSave}
              disabled={!!disabledHint || !dirty || invalidFields.size > 0}
              title={disabledHint}
              data-testid="capacity-save"
            >
              <LiveIcon name="save" size={13} /> {base ? "Save to simulation" : "Save to diagram"}
            </button>
          )}
        </footer>
      </aside>
    </FieldValidation.Provider>
  );
});

/**
 * No entry points yet (nothing in the diagram sends traffic): name where messages could enter and
 * add an upstream source there in one step, rather than a dead end.
 */
function NoEntryPoints({
  diagram,
  onAdd,
  disabledHint,
}: {
  diagram: DiagramFile;
  onAdd?: (nodeId: string) => void;
  disabledHint?: string;
}) {
  const targets = useMemo(() => entryCandidates(diagram), [diagram]);
  return (
    <div className="cap-start" data-testid="capacity-no-entries">
      <strong>Where does traffic enter?</strong>
      <span>
        {onAdd && targets.length
          ? "Nothing sends messages into this diagram yet. Add an entry point, then set its rate in msg/s."
          : "Nothing sends messages into this diagram yet. Add a client, partner or scheduler in front of where messages enter."}
      </span>
      {onAdd &&
        targets.map((n) => (
          <button
            key={n.id}
            className="lv-add cap-start-add"
            onClick={() => onAdd(n.id)}
            data-testid={`capacity-add-entry-${n.id}`}
            disabled={!!disabledHint}
            title={disabledHint}
          >
            <LiveIcon name="plus" size={12} /> Traffic into {n.label || n.id}
          </button>
        ))}
    </div>
  );
}

function Group({ title, hint, count, children }: { title: string; hint: string; count?: number; children: ReactNode }) {
  return (
    <section className="cap-section">
      <h4>
        {title}
        {count !== undefined && count > 0 && <span className="cap-count">{count}</span>}
      </h4>
      <p className="cap-hint">{hint}</p>
      <div className="cap-rows">{children}</div>
    </section>
  );
}

function Multiplier({
  id,
  label,
  hint,
  stops,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  stops: readonly number[];
  value: number;
  onChange: (v: number) => void;
}) {
  const index = nearestStop(stops, value || stops[0]);
  return (
    <label className="cap-mult">
      <span className="cap-mult-label">
        {label} <b>×</b>
        <small>{hint}</small>
      </span>
      <input
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(stops[Number(e.target.value)])}
        aria-valuetext={formatMultiplier(value)}
        data-testid={id}
        data-value={value}
        name={id}
        style={{ "--fill": `${(index / (stops.length - 1)) * 100}%` } as CSSProperties}
      />
      <output className="cap-mult-value mono" data-testid={`${id}-value`}>
        {formatMultiplier(value)}
      </output>
    </label>
  );
}

/** A number field that accepts "2k" / "1.5M", committing on Enter or blur. */
function RateInput({
  value,
  onCommit,
  testId,
  label,
  onValidity,
}: {
  value: number;
  onValidity: (valid: boolean) => void;
  onCommit: (v: number) => void;
  testId: string;
  label: string;
}) {
  // While typing, the box shows the draft; otherwise it follows the value (slider, presets).
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatRateInput(value);
  const setText = setDraft;
  const commit = () => {
    const v = parseRate(text);
    if (Number.isFinite(v) && v <= LIMITS.maxRatePerSec) onCommit(v);
  };
  const invalid = !Number.isFinite(parseRate(text)) || parseRate(text) > LIMITS.maxRatePerSec;
  return (
    <span className="cap-rate-field">
      <input
        className={`cap-rate-input mono${invalid ? " is-invalid" : ""}`}
        value={text}
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${testId}-error` : undefined}
        onFocus={() => setDraft(draft ?? formatRateInput(value))}
        onBlur={() => {
          commit();
          if (!invalid) setDraft(null);
        }}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseRate(e.target.value);
          onValidity(Number.isFinite(v) && v <= LIMITS.maxRatePerSec);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(formatRateInput(value));
            onValidity(true);
            e.stopPropagation();
          }
        }}
        data-testid={testId}
        name={testId}
      />
      {invalid && (
        <span id={`${testId}-error`} className="cap-error" role="alert" data-testid={`${testId}-error`}>
          Use 0–{LIMITS.maxRatePerSec.toLocaleString("en-US")} msg/s.
        </span>
      )}
    </span>
  );
}

function EntryRow({
  node,
  rate,
  traffic,
  onRate,
  onValidity,
}: {
  node: DiagramNode;
  rate: number;
  traffic: number;
  onRate: (rate: number) => void;
  onValidity: (valid: boolean) => void;
}) {
  // The slider's range stays put while dragging; it only grows when a typed rate goes past it.
  const [max, setMax] = useState(() => rateSliderMax(rate));
  if (rate > max) setMax(rateSliderMax(rate));
  const pos = sliderFromRate(rate, max);
  return (
    <div
      className="cap-row cap-entry"
      data-testid={`capacity-row-${node.id}`}
      data-capacity-node={node.id}
      role="group"
      aria-labelledby={`capacity-name-${node.id}`}
    >
      <div className="cap-row-head">
        <span className="cap-row-name" id={`capacity-name-${node.id}`}>
          {node.label || node.id}
        </span>
        {traffic !== 1 && (
          <span className="cap-row-note mono" data-testid={`capacity-effective-${node.id}`}>
            × {formatMultiplier(traffic).slice(0, -1)} = {formatRate(rate * traffic)}
          </span>
        )}
      </div>
      <div className="cap-rate">
        <input
          type="range"
          min={0}
          max={RATE_STEPS}
          step={1}
          value={pos}
          onChange={(e) => {
            onValidity(true);
            onRate(Math.min(LIMITS.maxRatePerSec, rateFromSlider(Number(e.target.value), max)));
          }}
          aria-label={`${node.label} rate`}
          aria-valuetext={`${formatRate(rate)} (messages per second)`}
          data-testid={`capacity-rate-slider-${node.id}`}
          name={`capacity-rate-slider-${node.id}`}
          style={{ "--fill": `${(pos / RATE_STEPS) * 100}%` } as CSSProperties}
        />
        <RateInput
          value={rate}
          onCommit={onRate}
          onValidity={onValidity}
          testId={`capacity-rate-${node.id}`}
          label={`${node.label}: messages per second`}
        />
        <span className="cap-unit">msg/s</span>
      </div>
    </div>
  );
}

function Pill({ heat }: { heat?: NodeHeat }) {
  if (!heat || heat.level === "idle")
    return <span className="cap-pill is-idle">{heat?.offered ? "no limit" : "idle"}</span>;
  if (heat.noReader && !heat.status)
    return (
      <span className={`cap-pill is-${heat.level}`} title={heat.text} data-testid={`capacity-pill-${heat.id}`}>
        no reader
      </span>
    );
  return (
    <span className={`cap-pill is-${heat.level}`} title={heat.text} data-testid={`capacity-pill-${heat.id}`}>
      {formatUtilization(heat.utilization)}
    </span>
  );
}

function NumericInput({
  value,
  min,
  max,
  step,
  integer = false,
  onChange,
  testId,
  label,
}: {
  value: number;
  min: number;
  max?: number;
  step: number;
  integer?: boolean;
  onChange: (value: number) => void;
  testId: string;
  label: string;
}) {
  const [invalidDraft, setInvalidDraft] = useState<string | null>(null);
  const validity = useContext(FieldValidation);
  const invalid = invalidDraft !== null;
  return (
    <span className="cap-numeric-field">
      <input
        type="number"
        value={invalidDraft ?? (Number.isFinite(value) ? Math.round(value * 100) / 100 : "")}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${testId}-error` : undefined}
        data-testid={testId}
        name={testId}
        onChange={(e) => {
          const text = e.target.value,
            v = Number(text);
          const valid =
            text !== "" &&
            Number.isFinite(v) &&
            v >= min &&
            (max === undefined || v <= max) &&
            (!integer || Number.isInteger(v));
          setInvalidDraft(valid ? null : text);
          validity(testId, valid);
          if (valid) onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && invalid) {
            setInvalidDraft(null);
            validity(testId, true);
            e.stopPropagation();
          }
        }}
      />
      {invalid && (
        <span id={`${testId}-error`} role="alert" className="cap-error" data-testid={`${testId}-error`}>
          Use {integer ? "a whole number " : ""}from {min} to {max ?? "a finite value"}.
        </span>
      )}
    </span>
  );
}

function Stepper({
  value,
  min = 1,
  onChange,
  testId,
  label,
}: {
  value: number;
  min?: number;
  onChange: (v: number) => void;
  testId: string;
  label: string;
}) {
  return (
    <div className="cap-stepper" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Fewer ${label.toLowerCase()}`}
        data-testid={`${testId}-dec`}
      >
        <LiveIcon name="minus" size={12} />
      </button>
      <NumericInput
        value={value}
        min={min}
        max={SIM_LIMITS.count}
        step={1}
        integer
        onChange={onChange}
        testId={testId}
        label={label}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= SIM_LIMITS.count}
        aria-label={`More ${label.toLowerCase()}`}
        data-testid={`${testId}-inc`}
      >
        <LiveIcon name="plus" size={12} />
      </button>
    </div>
  );
}

function NumberBox({
  value,
  unit,
  onChange,
  testId,
  label,
  name,
  min = 0,
  max,
  step = 1,
}: {
  value: number;
  unit: string;
  onChange: (v: number) => void;
  testId: string;
  label: string;
  name: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="cap-field">
      <span>{label}</span>
      <span className="cap-box">
        <NumericInput
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          testId={testId}
          label={`${name} ${label}`}
        />
        <i>{unit}</i>
      </span>
    </label>
  );
}

function ServiceRow({
  node,
  heat,
  props,
  capacity,
  onProp,
}: {
  node: DiagramNode;
  heat?: NodeHeat;
  props: ReturnType<typeof baseProps>;
  capacity: number;
  onProp: (key: string, value: unknown) => void;
}) {
  if (props.autoscaling?.mode === "on") {
    const range = replicaRange(props.autoscaling.controller, capacity);
    return (
      <div className="cap-row" data-testid={`capacity-service-${node.id}`}>
        <strong>{node.label}</strong>
        <p data-testid={`capacity-hpa-range-${node.id}`}>
          {t("autoscaling.range", { initial: range.initial, min: range.min, max: range.max })}
        </p>
        <small>{heat?.text}</small>
      </div>
    );
  }
  const effective = Math.max(1, Math.round(props.replicas * capacity));
  return (
    <div
      className={`cap-row cap-service is-${heat?.level ?? "idle"}`}
      data-testid={`capacity-row-${node.id}`}
      data-capacity-node={node.id}
      role="group"
      aria-labelledby={`capacity-name-${node.id}`}
    >
      <div className="cap-row-head">
        <span className="cap-row-name" id={`capacity-name-${node.id}`}>
          {node.label || node.id}
        </span>
        {heat && heat.offered > 0 && <span className="cap-row-note mono">{formatRate(heat.offered)}</span>}
        <Pill heat={heat} />
      </div>
      <div className="cap-fields">
        <div className="cap-field">
          <span>Replicas</span>
          <Stepper
            value={props.replicas}
            onChange={(v) => onProp("replicas", v)}
            testId={`capacity-replicas-${node.id}`}
            label={`${node.label || node.id} Replicas`}
          />
        </div>
        <NumberBox
          label="Latency"
          name={node.label || node.id}
          unit="ms"
          value={props.latencyMs}
          step={10}
          max={LIMITS.maxSimulationMs}
          onChange={(v) => onProp("latencyMs", v)}
          testId={`capacity-latency-${node.id}`}
        />
        <NumberBox
          label="Failures"
          name={node.label || node.id}
          unit="%"
          value={props.failureRate * 100}
          max={100}
          onChange={(v) => onProp("failureRate", v / 100)}
          testId={`capacity-failure-${node.id}`}
        />
      </div>
      {(capacity !== 1 || (heat && heat.idleReplicas > 0)) && (
        <p className="cap-row-foot" data-testid={`capacity-replica-note-${node.id}`}>
          {capacity !== 1 && `${effective} replicas with Capacity × ${formatMultiplier(capacity).slice(0, -1)}. `}
          {heat && heat.idleReplicas > 0 && (
            <span className="cap-warn-text">
              {t("broker.assigned", { active: heat.activeReplicas, configured: heat.replicas })} ·{" "}
              {assignmentLabel(heat.assignment)}
            </span>
          )}
        </p>
      )}
      <details className="cap-advanced" data-testid={`capacity-advanced-${node.id}`}>
        <summary data-testid={`capacity-advanced-${node.id}-toggle`}>
          <LiveIcon name="chevron" size={11} className="lv-disclosure-chevron" /> Advanced
          <small>parallel work, jitter, retries</small>
        </summary>
        <div className="cap-fields">
          <NumberBox
            label="Parallel"
            name={node.label || node.id}
            unit="each"
            min={1}
            max={SIM_LIMITS.count}
            value={props.concurrency}
            onChange={(v) => onProp("concurrency", Math.floor(v))}
            testId={`capacity-concurrency-${node.id}`}
          />
          <NumberBox
            label="Jitter"
            name={node.label || node.id}
            unit="±%"
            max={100}
            step={5}
            value={props.jitter * 100}
            onChange={(v) => onProp("jitter", v / 100)}
            testId={`capacity-jitter-${node.id}`}
          />
          <label className="cap-field">
            <span>On failure</span>
            <select
              aria-label={`${node.label || node.id} On failure`}
              value={props.retry}
              onChange={(e) => onProp("retry", e.target.value)}
              data-testid={`capacity-retry-${node.id}`}
              name={`capacity-retry-${node.id}`}
            >
              <option value="requeue">Requeue</option>
              <option value="inplace">Retry in place</option>
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}

function BrokerRow({
  node,
  heat,
  partitions,
  broker,
  note,
  onPartitions,
}: {
  node: DiagramNode;
  heat?: NodeHeat;
  partitions: number;
  broker?: BrokerSpec;
  /** Why more partitions change nothing here (partitionsNotes), once they're raised. */
  note?: string;
  onPartitions: (n: number) => void;
}) {
  const role = stencilRole(node.stencil);
  return (
    <div
      className={`cap-row cap-broker is-${heat?.level ?? "idle"}`}
      data-testid={`capacity-row-${node.id}`}
      data-capacity-node={node.id}
      role="group"
      aria-labelledby={`capacity-name-${node.id}`}
    >
      <div className="cap-row-head">
        <span className="cap-row-name" id={`capacity-name-${node.id}`}>
          {node.label || node.id}
        </span>
        {heat && heat.offered > 0 && <span className="cap-row-note mono">{formatRate(heat.offered)}</span>}
        <Pill heat={heat} />
      </div>
      {role === "queue" ? (
        <p className="cap-row-foot">Competing consumers: every replica can work.</p>
      ) : !broker?.partitioned ? (
        <p className="cap-row-foot" data-testid={`capacity-fanout-${node.id}`}>
          {assignmentLabel(broker)} · {t("broker.fanout")}
        </p>
      ) : (
        <div className="cap-fields">
          <div className="cap-field">
            <span>{assignmentLabel(broker)}</span>
            <Stepper
              value={partitions}
              onChange={onPartitions}
              testId={`capacity-partitions-${node.id}`}
              label={`${node.label || node.id} ${assignmentLabel(broker)}`}
            />
          </div>
        </div>
      )}
      {note && (
        <p className="cap-row-foot" data-testid={`capacity-partitions-note-${node.id}`}>
          {note}
        </p>
      )}
    </div>
  );
}

function ScaleIndicator({
  scale,
  running,
  diagram,
  base,
  inputs,
  onScale,
}: {
  scale: number;
  running: Simulation | null;
  diagram: DiagramFile;
  base: Simulation | null;
  inputs: LiveInputs;
  onScale: (scale: number) => void;
}) {
  const auto = useMemo(
    () =>
      running
        ? autoScale({ ...running, scale: undefined }, diagram)
        : freePlayScale(diagram, { ...inputs, scale: undefined }),
    [running, diagram, inputs],
  );
  const options = useMemo(() => scaleOptions(auto, scale), [auto, scale]);
  return (
    <div className="cap-scale" data-testid="scale-indicator" data-scale={scale}>
      <span className="cap-scale-dot" aria-hidden />
      <span>
        1 dot ≈ <b className="mono">{formatScale(scale)}</b> {scale === 1 ? "message" : "messages"}
        <small>
          {revisionAtLeast(diagram.planning?.revision, "p3-w1")
            ? t("threads.sampling")
            : "Dots are sampled; counters count every message."}
        </small>
      </span>
      <label className="lv-select cap-scale-select" title="How many real messages each dot stands for">
        <span className="sr-only">Messages per dot</span>
        <select
          value={String(scale)}
          onChange={(e) => onScale(e.target.value === "auto" ? auto : Number(e.target.value))}
          data-testid="scale-override"
          name="scale-override"
        >
          <option value="auto">Auto ({formatScale(auto)})</option>
          {options.map((v) => (
            <option key={v} value={String(v)}>
              {formatScale(v)}
              {v === auto ? " (auto)" : base?.scale === v && inputs.scale === undefined ? " (saved)" : ""}
            </option>
          ))}
        </select>
        <LiveIcon name="chevron" size={11} />
      </label>
    </div>
  );
}
