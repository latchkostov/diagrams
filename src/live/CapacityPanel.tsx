import { useState, type CSSProperties, type ReactNode } from "react";
import type { DiagramFile, DiagramNode, Simulation } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { autoScale } from "../sim/scale";
import type { LiveState } from "./controller";
import { useLive } from "./context";
import {
  applyPreset,
  baseProps,
  CAPACITY_STOPS,
  emptyInputs,
  entryRates,
  formatMultiplier,
  formatRateInput,
  formatUtilization,
  freePlayScale,
  hasInputs,
  isPresetActive,
  nearestStop,
  parseRate,
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
import { capacityOverlay, useCapacityOverlay } from "./capacityOverlay";
import { BottleneckCallout } from "./CapacityLayer";
import { formatCount, formatRate } from "./format";
import { LiveIcon } from "./icons";
import { usePanelEscape } from "./usePanelEscape";

interface Props {
  state: LiveState;
  view: CapacityView;
  onClose: () => void;
  /** Undoable fix; omitted where nothing can be edited. */
  onApplyFix?: (fix: CapacityFix) => void;
  /** Writes the inputs (simulation or diagram); omitted where nothing can be saved (the Lab). */
  onSave?: () => void;
}

/**
 * "Inputs & capacity": one place to say how much traffic enters, how big each service is and how
 * many partitions each topic has, generated from the diagram. Everything applies to the running
 * view at once; Save writes it (undoably) to the simulation, or to the diagram in free play.
 */
export function CapacityPanel({ state, view, onClose, onApplyFix, onSave }: Props) {
  const ui = useLive();
  const c = ui.controller;
  const diagram = c.currentDiagram;
  const base = state.simulation;
  const inputs = state.inputs;
  const overlay = useCapacityOverlay();
  const [showAll, setShowAll] = useState(false);
  usePanelEscape(onClose);

  const set = (next: LiveInputs) => c.setInputs(next);
  const setProp = (id: string, key: string, value: unknown) =>
    set({ ...inputs, props: { ...inputs.props, [id]: { ...inputs.props[id], [key]: value } } });
  const rates = entryRates(diagram, base, inputs);
  const rows = selectRows(diagram, view, rates.keys(), { showAll });
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const props = (n: DiagramNode) => baseProps(n, base, inputs.props[n.id]);
  const traffic = inputs.traffic ?? base?.multipliers?.traffic ?? 1;
  const capacity = inputs.capacity ?? base?.multipliers?.capacity ?? 1;
  const dirty = hasInputs(inputs);

  return (
    <aside
      className="lv-panel cap-panel"
      data-testid="capacity-panel"
      data-editor-overlay
      aria-label="Inputs and capacity"
    >
      <header className="lv-panel-head">
        <LiveIcon name="gauge" size={16} />
        <strong>Inputs &amp; capacity</strong>
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
          {base ? (
            <>
              For <b>{base.title}</b>. Changes apply now; save to keep them.
            </>
          ) : (
            "Free play: rates and sizes from the diagram. Changes apply now; save to keep them."
          )}
        </p>

        <BottleneckCallout view={view} onApply={onApplyFix} />

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
            {PRESETS.map((p) => {
              const on = isPresetActive(p.id, inputs, diagram, base);
              return (
                <button
                  key={p.id}
                  className={`cap-preset${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  title={p.hint}
                  onClick={() => set(applyPreset(p.id, inputs, diagram, base))}
                  data-testid={`capacity-preset-${p.id}`}
                >
                  {p.label}
                  {p.id === "black-friday" && <small>5×</small>}
                </button>
              );
            })}
          </div>
          <label className="cap-switch-row">
            <span>
              Show capacity on the diagram
              <small>Colour every service by how busy it is (C)</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={overlay}
              onChange={(e) => capacityOverlay.set(e.target.checked)}
              data-testid="capacity-panel-overlay"
              name="capacity-overlay"
            />
          </label>
        </section>

        <Group title="Entry points" hint="How many messages enter here per second" count={rows.entries.length}>
          {rows.entries.length === 0 && <p className="cap-empty">No sources or traffic yet.</p>}
          {rows.entries.map((id) => (
            <EntryRow
              key={id}
              node={byId.get(id)!}
              rate={rates.get(id) ?? 0}
              traffic={traffic}
              onRate={(rate) => set({ ...inputs, rates: { ...inputs.rates, [id]: rate } })}
            />
          ))}
        </Group>

        {rows.services.length > 0 && (
          <Group title="Services" hint="Replicas are pods; latency is the time to handle one message">
            {rows.services.map((id) => (
              <ServiceRow
                key={id}
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
          <Group title="Topics & queues" hint="Partitions cap how many consumers in a group work at once">
            {rows.brokers.map((id) => (
              <BrokerRow
                key={id}
                node={byId.get(id)!}
                heat={view.nodes[id]}
                partitions={props(byId.get(id)!).partitions}
                onPartitions={(n) => setProp(id, "partitions", n)}
              />
            ))}
          </Group>
        )}

        {(rows.hidden > 0 || showAll) && (
          <button className="lv-add cap-show-all" onClick={() => setShowAll((s) => !s)} data-testid="capacity-show-all">
            <LiveIcon name="chevron" size={12} className={showAll ? "lv-rot180" : undefined} />
            {showAll ? "Show the busiest only" : `Show all (${rows.hidden} more)`}
          </button>
        )}

        <ScaleIndicator
          state={state}
          diagram={diagram}
          base={base}
          inputs={inputs}
          onScale={(scale) => set({ ...inputs, scale })}
        />

        <p className="cap-footnote">
          Planning estimate at peak rates. Gateways and databases aren&apos;t capacity-limited in this simulation.
        </p>
      </div>

      <footer className="lv-panel-foot">
        <button
          className="btn"
          onClick={() => c.setInputs(emptyInputs())}
          disabled={!dirty}
          data-testid="capacity-reset"
          title="Back to the saved values"
        >
          Reset
        </button>
        <span className="lv-grow" />
        {onSave && (
          <button className="btn btn-primary" onClick={onSave} disabled={!dirty} data-testid="capacity-save">
            <LiveIcon name="save" size={13} /> {base ? "Save to simulation" : "Save to diagram"}
          </button>
        )}
      </footer>
    </aside>
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
}: {
  value: number;
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
    if (Number.isFinite(v)) onCommit(v);
  };
  const invalid = !Number.isFinite(parseRate(text));
  return (
    <input
      className={`cap-rate-input mono${invalid ? " is-invalid" : ""}`}
      value={text}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      onFocus={() => setDraft(formatRateInput(value))}
      onBlur={() => {
        commit();
        setDraft(null);
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(formatRateInput(value));
          e.stopPropagation();
        }
      }}
      data-testid={testId}
      name={testId}
    />
  );
}

function EntryRow({
  node,
  rate,
  traffic,
  onRate,
}: {
  node: DiagramNode;
  rate: number;
  traffic: number;
  onRate: (rate: number) => void;
}) {
  // The slider's range stays put while dragging; it only grows when a typed rate goes past it.
  const [max, setMax] = useState(() => rateSliderMax(rate));
  if (rate > max) setMax(rateSliderMax(rate));
  const pos = sliderFromRate(rate, max);
  return (
    <div className="cap-row cap-entry" data-testid={`capacity-row-${node.id}`}>
      <div className="cap-row-head">
        <span className="cap-row-name">{node.label || node.id}</span>
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
          onChange={(e) => onRate(rateFromSlider(Number(e.target.value), max))}
          aria-label={`${node.label} rate`}
          aria-valuetext={`${formatRate(rate)} (messages per second)`}
          data-testid={`capacity-rate-slider-${node.id}`}
          name={`capacity-rate-slider-${node.id}`}
          style={{ "--fill": `${(pos / RATE_STEPS) * 100}%` } as CSSProperties}
        />
        <RateInput
          value={rate}
          onCommit={onRate}
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
  return (
    <span className={`cap-pill is-${heat.level}`} title={heat.text} data-testid={`capacity-pill-${heat.id}`}>
      {formatUtilization(heat.utilization)}
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
      <input
        type="number"
        min={min}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => {
          const v = Math.floor(Number(e.target.value));
          if (Number.isFinite(v) && v >= min) onChange(v);
        }}
        data-testid={testId}
        name={testId}
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
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
  min = 0,
  max,
  step = 1,
}: {
  value: number;
  unit: string;
  onChange: (v: number) => void;
  testId: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="cap-field">
      <span>{label}</span>
      <span className="cap-box">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? Math.round(value * 100) / 100 : ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v) && v >= min && (max === undefined || v <= max)) onChange(v);
          }}
          data-testid={testId}
          name={testId}
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
  const effective = Math.max(1, Math.round(props.replicas * capacity));
  return (
    <div className={`cap-row cap-service is-${heat?.level ?? "idle"}`} data-testid={`capacity-row-${node.id}`}>
      <div className="cap-row-head">
        <span className="cap-row-name">{node.label || node.id}</span>
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
            label="Replicas"
          />
        </div>
        <NumberBox
          label="Latency"
          unit="ms"
          value={props.latencyMs}
          step={10}
          onChange={(v) => onProp("latencyMs", v)}
          testId={`capacity-latency-${node.id}`}
        />
        <NumberBox
          label="Failures"
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
              {heat.idleReplicas} of {heat.replicas} idle: not enough partitions.
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
            unit="each"
            min={1}
            value={props.concurrency}
            onChange={(v) => onProp("concurrency", Math.floor(v))}
            testId={`capacity-concurrency-${node.id}`}
          />
          <NumberBox
            label="Jitter"
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
  onPartitions,
}: {
  node: DiagramNode;
  heat?: NodeHeat;
  partitions: number;
  onPartitions: (n: number) => void;
}) {
  const role = stencilRole(node.stencil);
  return (
    <div className={`cap-row cap-broker is-${heat?.level ?? "idle"}`} data-testid={`capacity-row-${node.id}`}>
      <div className="cap-row-head">
        <span className="cap-row-name">{node.label || node.id}</span>
        {heat && heat.offered > 0 && <span className="cap-row-note mono">{formatRate(heat.offered)}</span>}
        <Pill heat={heat} />
      </div>
      {role === "queue" ? (
        <p className="cap-row-foot">Competing consumers: every replica can work.</p>
      ) : (
        <div className="cap-fields">
          <div className="cap-field">
            <span>Partitions</span>
            <Stepper
              value={partitions}
              onChange={onPartitions}
              testId={`capacity-partitions-${node.id}`}
              label="Partitions"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ScaleIndicator({
  state,
  diagram,
  base,
  inputs,
  onScale,
}: {
  state: LiveState;
  diagram: DiagramFile;
  base: Simulation | null;
  inputs: LiveInputs;
  onScale: (scale: number) => void;
}) {
  const scale = state.scale;
  const auto = state.running
    ? autoScale({ ...state.running, scale: undefined }, diagram)
    : freePlayScale(diagram, { ...inputs, scale: undefined });
  const options = scaleOptions(auto, scale);
  return (
    <div className="cap-scale" data-testid="scale-indicator" data-scale={scale}>
      <span className="cap-scale-dot" aria-hidden />
      <span>
        1 dot ≈ <b className="mono">{formatCount(scale)}</b> {scale === 1 ? "message" : "messages"}
        <small>Dots are sampled; counters count every message.</small>
      </span>
      <label className="lv-select cap-scale-select" title="How many real messages each dot stands for">
        <span className="sr-only">Messages per dot</span>
        <select
          value={String(scale)}
          onChange={(e) => onScale(e.target.value === "auto" ? auto : Number(e.target.value))}
          data-testid="scale-override"
          name="scale-override"
        >
          <option value="auto">Auto ({formatCount(auto)})</option>
          {options.map((v) => (
            <option key={v} value={String(v)}>
              {formatCount(v)}
              {v === auto ? " (auto)" : base?.scale === v && inputs.scale === undefined ? " (saved)" : ""}
            </option>
          ))}
        </select>
        <LiveIcon name="chevron" size={11} />
      </label>
    </div>
  );
}
