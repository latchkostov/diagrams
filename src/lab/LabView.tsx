import { safeStorage } from "../lib/storage";
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import "../styles/lab.css";
import type { DiagramFile } from "../model/types";
import { useSettings, type Settings } from "../harness/settings";
import { parseDiagram } from "../lib/diagramIO";
import { Icon } from "../components/Icon";
import { CUSTOM_PRESET_ID, CUSTOM_STORAGE_KEY, DEFAULT_PRESET_ID, getPreset, presets } from "./presets";
import { defaultsOf, encodeValue, readValues, writeValues } from "./controls";
import { diagramProblems } from "./generators";
import { LOOK_CONTROLS, LOOK_KEYS, lookSetting, type LookKey } from "./look";
import { LabCanvas } from "./LabCanvas";
import { SimReadout } from "./SimReadout";
import { ControlField } from "./ControlField";
import { ExampleLoadError, resetExampleResource } from "./exampleDiagram";
import { PRESET_GROUPS, type ControlValue, type ControlValues, type Preset } from "./types";

export type OpenTarget = { slug: string } | { diagram: DiagramFile };

interface Props {
  /** Hand a diagram (or an example slug) to the full Canvas editor. */
  onOpen: (target: OpenTarget) => void;
}

const LOOK_KEY_SET: ReadonlySet<string> = new Set(LOOK_KEYS);

function readUrl(): { preset: Preset; values: ControlValues; params: URLSearchParams } {
  const params = new URLSearchParams(window.location.search);
  const preset = getPreset(params.get("preset")) ?? getPreset(DEFAULT_PRESET_ID)!;
  return { preset, values: readValues(preset.controls, params), params };
}

/**
 * The Lab: a mini-Storybook driven by the real components. Left: presets. Centre: the stage.
 * Right: controls generated from the preset's schema, the global look, and a JSON loader.
 * Everything is URL-addressable: ?view=lab&preset=<id>&<control>=<value>.
 */
export function LabView({ onOpen }: Props) {
  const settings = useSettings();
  const [{ preset, values }, setState] = useState(() => {
    const { preset, values } = readUrl();
    return { preset, values };
  });
  const [customVersion, setCustomVersion] = useState(0);
  const [render, setRender] = useState<{ key: string; ms: number } | null>(null);

  // URL -> look settings (theme / node variant / edge style), on load and on Back / Forward.
  const applyLookFromUrl = useCallback(
    (params: URLSearchParams) => {
      for (const c of LOOK_CONTROLS) {
        const raw = params.get(c.key);
        if (raw && (c.options as readonly { value: string }[]).some((o) => o.value === raw)) {
          const k = lookSetting[c.key];
          if (settings[k] !== raw) settings.set(k, raw as never);
        }
      }
    },
    [settings],
  );
  const applyLookRef = useRef(applyLookFromUrl);
  useLayoutEffect(() => {
    applyLookRef.current = applyLookFromUrl;
  }, [applyLookFromUrl]);

  useEffect(() => {
    const sync = () => {
      const { preset, values, params } = readUrl();
      setState({ preset, values });
      applyLookRef.current(params);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const writeUrl = (p: Preset, v: ControlValues, push: boolean) => {
    const params = writeValues(new URLSearchParams(window.location.search), p.id, p.controls, v, LOOK_KEY_SET);
    const url = `${window.location.pathname}?${params}${window.location.hash}`;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };

  const selectPreset = useCallback((id: string) => {
    const p = getPreset(id);
    if (!p) return;
    const v = defaultsOf(p.controls);
    setState({ preset: p, values: v });
    writeUrl(p, v, true);
  }, []);

  const setValue = (key: string, value: ControlValue) => {
    const v = { ...values, [key]: value };
    setState({ preset, values: v });
    writeUrl(preset, v, false);
  };

  const resetValues = () => {
    const v = defaultsOf(preset.controls);
    setState({ preset, values: v });
    writeUrl(preset, v, false);
  };

  const setLook = (key: LookKey, value: string) => {
    settings.set(lookSetting[key], value as never);
    const params = new URLSearchParams(window.location.search);
    const def = LOOK_CONTROLS.find((c) => c.key === key)!.default;
    if (value === def) params.delete(key);
    else params.set(key, value);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
  };

  // Sidebar
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return presets.filter(
      (p) => !needle || `${p.title} ${p.id} ${p.group} ${p.description ?? ""}`.toLowerCase().includes(needle),
    );
  }, [q]);

  // "/" focuses search; "[" and "]" step through presets.
  const presetRef = useRef(preset);
  useLayoutEffect(() => {
    presetRef.current = preset;
  }, [preset]);
  const visibleRef = useRef(visible);
  useLayoutEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
        return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "[" || e.key === "]") {
        const list = visibleRef.current;
        const i = list.findIndex((p) => p.id === presetRef.current.id);
        const next = list[(i + (e.key === "]" ? 1 : -1) + list.length) % list.length];
        if (next) selectPreset(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectPreset]);

  // Speed controls playback, not the diagram or scenario identity.
  const stageValuesKey = JSON.stringify(
    Object.fromEntries(Object.entries(values).filter(([key]) => preset.kind !== "scenario" || key !== "speed")),
  );
  const stageValues = useMemo(() => JSON.parse(stageValuesKey) as ControlValues, [stageValuesKey]);
  const stageKey = `${preset.id}:${stageValuesKey}:${preset.id === CUSTOM_PRESET_ID ? customVersion : 0}`;
  const onRendered = useCallback((ms: number) => setRender({ key: stageKey, ms }), [stageKey]);

  const currentDiagram = (): DiagramFile | null => {
    if (preset.kind === "render") return null;
    try {
      return preset.diagram(values);
    } catch {
      return null;
    }
  };

  const openInEditor = () => {
    if (preset.kind === "diagram" && preset.exampleSlug) return onOpen({ slug: preset.exampleSlug });
    const d = currentDiagram();
    if (d) onOpen({ diagram: d });
  };

  const [copied, setCopied] = useState(false);
  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };

  const loadJson = (d: DiagramFile) => {
    if (!safeStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(d)))
      return "Storage is unavailable or full. Export your diagram or free browser storage and try again.";
    setCustomVersion((n) => n + 1);
    selectPreset(CUSTOM_PRESET_ID);
  };

  const nonDefault = (preset.controls ?? []).some((c) => values[c.key] !== c.default);
  const renderInfo = render?.key === stageKey ? render.ms : null;

  return (
    <div className="lab" data-testid="lab-view">
      <aside className="lab-sidebar" data-testid="lab-sidebar">
        <div className="lab-sidebar-head">
          <div className="lab-title">
            <span>Lab</span>
            <span className="lab-count">{presets.length} presets</span>
          </div>
          <div className="field">
            <Icon name="search" />
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a preset"
              aria-label="Find a preset"
              name="lab-search"
              data-testid="lab-search"
            />
            <kbd>/</kbd>
          </div>
        </div>
        <nav className="lab-nav" aria-label="Presets">
          {PRESET_GROUPS.map((g) => {
            const items = visible.filter((p) => p.group === g);
            if (!items.length) return null;
            return (
              <section key={g} data-testid={`lab-group-${g.toLowerCase()}`}>
                <h4>
                  {g} <span>{items.length}</span>
                </h4>
                {items.map((p) => (
                  <button
                    key={p.id}
                    className={`lab-link${p.id === preset.id ? " is-on" : ""}`}
                    aria-current={p.id === preset.id ? "page" : undefined}
                    onClick={() => selectPreset(p.id)}
                    title={p.description}
                    data-testid={`lab-preset-link-${p.id}`}
                  >
                    <KindGlyph kind={p.kind} />
                    <span>{p.title}</span>
                  </button>
                ))}
              </section>
            );
          })}
          {!visible.length && <p className="lab-empty-search">No presets match “{q}”.</p>}
        </nav>
        <div className="lab-sidebar-foot">
          <kbd>[</kbd> <kbd>]</kbd> previous / next
        </div>
      </aside>

      <main className="lab-main">
        <header className="lab-stage-head">
          <div className="lab-stage-heading">
            <div className="lab-crumb">
              {preset.group} <span>/</span> <code>{preset.id}</code>
            </div>
            <h1 data-testid="lab-preset-title">{preset.title}</h1>
            {preset.description && <p data-testid="lab-preset-description">{preset.description}</p>}
          </div>
          <div className="lab-stage-actions">
            {preset.kind !== "render" && (
              <button
                className="btn"
                onClick={openInEditor}
                data-testid="lab-open-editor"
                title="Open this diagram in the full Canvas editor"
              >
                <Icon name="canvas" size={14} /> Open in editor
              </button>
            )}
            <button
              className="btn"
              onClick={copyLink}
              data-testid="lab-copy-link"
              title="Copy a link to this preset with these controls"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </header>

        <div
          className={`lab-stage lab-stage-${preset.kind}`}
          role="region"
          aria-label={`${preset.title} preview`}
          // Render presets scroll (overflow: auto): focusable so the keyboard can scroll them too.
          tabIndex={preset.kind === "render" ? 0 : undefined}
          data-testid="lab-stage"
          data-preset={preset.id}
          data-kind={preset.kind}
        >
          <PresetBoundary resetKey={stageKey}>
            <Suspense
              fallback={
                <div role="status" data-testid="lab-example-loading">
                  Loading example…
                </div>
              }
            >
              <PresetStage
                key={stageKey}
                preset={preset}
                values={stageValues}
                speed={Number(values.speed) || 1}
                onRendered={onRendered}
              />
            </Suspense>
          </PresetBoundary>
        </div>

        {preset.kind !== "render" && (
          <footer className="lab-stage-foot mono" data-testid="lab-render-time" data-ms={renderInfo ?? ""}>
            {renderInfo == null ? "Rendering…" : `Rendered in ${renderInfo} ms`}
          </footer>
        )}
      </main>

      <aside className="lab-panel" data-testid="lab-controls">
        {!!preset.controls?.length && (
          <section className="lab-panel-section">
            <div className="lab-panel-title">
              <h4>Controls</h4>
              {nonDefault && (
                <button className="link-btn" onClick={resetValues} data-testid="lab-reset-controls">
                  <Icon name="reset" size={12} /> Reset
                </button>
              )}
            </div>
            {preset.controls.map((c) => (
              <ControlField
                key={`${preset.id}:${c.key}`}
                def={c}
                value={values[c.key]}
                onChange={(v) => setValue(c.key, v)}
                testId={`lab-control-${c.key}`}
              />
            ))}
          </section>
        )}

        <section className="lab-panel-section">
          <div className="lab-panel-title">
            <h4>Look</h4>
          </div>
          {LOOK_CONTROLS.map((c) => (
            <ControlField
              key={c.key}
              def={c}
              value={settings[lookSetting[c.key]] as Settings[keyof Settings]}
              onChange={(v) => setLook(c.key, String(v))}
              testId={`lab-look-${c.key}`}
            />
          ))}
        </section>

        <JsonLoader onLoad={loadJson} current={currentDiagram} />

        <section className="lab-panel-section lab-panel-help">
          <div className="lab-panel-title">
            <h4>Link</h4>
          </div>
          <code className="lab-url" data-testid="lab-url">
            ?{new URLSearchParams(writeValues(new URLSearchParams(), preset.id, preset.controls, values)).toString()}
            {LOOK_CONTROLS.filter((c) => settings[lookSetting[c.key]] !== c.default)
              .map((c) => `&${c.key}=${encodeValue(settings[lookSetting[c.key]] as string)}`)
              .join("")}
          </code>
        </section>
      </aside>
    </div>
  );
}

function PresetStage({
  preset,
  values,
  speed,
  onRendered,
}: {
  preset: Preset;
  values: ControlValues;
  speed: number;
  onRendered: (ms: number) => void;
}) {
  const diagram = useMemo(() => (preset.kind === "render" ? null : preset.diagram(values)), [preset, values]);
  const scenario = useMemo(() => (preset.kind === "scenario" ? preset.scenario(values) : null), [preset, values]);

  if (preset.kind === "render") return <div className="lab-render">{preset.render(values)}</div>;
  if (!diagram) return null;
  const canvas = (
    <div className="lab-canvas-wrap">
      <LabCanvas diagram={diagram} onRendered={onRendered} minimap={preset.kind === "diagram"} />
      <div className="lab-canvas-badge mono" data-testid="lab-diagram-stats">
        {diagram.nodes.length} nodes · {diagram.edges.length} edges
        {diagram.groups?.length ? ` · ${diagram.groups.length} groups` : ""}
      </div>
      {!diagram.nodes.length && (
        <div className="lab-canvas-empty" data-testid="lab-canvas-empty">
          <strong>{diagram.title}</strong>
          {diagram.description && <span>{diagram.description}</span>}
        </div>
      )}
    </div>
  );
  if (preset.kind === "diagram" || !scenario) return canvas;
  return (
    <div className="lab-split">
      {canvas}
      <SimReadout
        diagram={diagram}
        scenario={scenario}
        speed={speed}
        seed={Number(values.seed) || 1}
        autoplay={values.autoplay !== false}
      />
    </div>
  );
}

function JsonLoader({
  onLoad,
  current,
}: {
  onLoad: (d: DiagramFile) => string | undefined;
  current: () => DiagramFile | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const r = parseDiagram(text);
    if (!r.ok) return setError(r.error);
    const problems = diagramProblems(r.diagram);
    if (problems.length)
      return setError(`That diagram has problems: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "…" : ""}`);
    setError(onLoad(r.diagram) ?? null);
  };

  return (
    <section className="lab-panel-section">
      <div className="lab-panel-title">
        <h4>Load JSON</h4>
        <button
          className="link-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="lab-json-toggle"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <div className="lab-json">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{ "format": "diagrams/v1", "title": "…", "nodes": [], "edges": [] }'
            spellCheck={false}
            name="lab-json"
            aria-label="Diagram JSON"
            data-testid="lab-json-input"
          />
          {error && (
            <p className="lab-json-error" role="alert" data-testid="lab-json-error">
              {error}
            </p>
          )}
          <div className="lab-json-actions">
            <button className="btn btn-primary" onClick={apply} disabled={!text.trim()} data-testid="lab-json-apply">
              Render
            </button>
            <button
              className="btn"
              onClick={() => {
                const d = current();
                if (d) {
                  setText(JSON.stringify(d, null, 2));
                  setError(null);
                }
              }}
              data-testid="lab-json-from-preset"
              title="Start from the current preset's diagram"
            >
              Use current
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function KindGlyph({ kind }: { kind: Preset["kind"] }) {
  const d =
    kind === "render"
      ? "M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z"
      : kind === "diagram"
        ? "M2.5 4h4v3h-4zM9.5 9h4v3h-4zM6.5 5.5h1.5a1.5 1.5 0 0 1 1.5 1.5v3"
        : "M3 8h2l1.5-4 3 8L11 8h2";
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`lab-kind lab-kind-${kind}`}
    >
      <path d={d} />
    </svg>
  );
}

/** Keeps one broken preset from taking down the Lab. */
class PresetBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null; key: string }
> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[lab] preset crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A failed example download isn't a crash: Retry downloads it again.
    const download = error instanceof ExampleLoadError;
    const retry = () => {
      if (download) resetExampleResource(error.slug);
      this.setState({ error: null });
    };
    return (
      <div className="lab-stage-error" role="alert" data-testid="lab-stage-error">
        <strong>{download ? "This example didn't load." : "This preset crashed while rendering."}</strong>
        <code>{error.message}</code>
        {!download && error.stack && <pre>{error.stack.split("\n").slice(0, 8).join("\n")}</pre>}
        <button className="btn" onClick={retry} data-testid="lab-stage-retry">
          <Icon name="reset" size={14} /> Retry
        </button>
      </div>
    );
  }
}
