import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { DiagramFile } from "../model/types";
import type { NodeStatus, SimSnapshot } from "../sim/types";
import { simRoleMeta } from "../lib/simRoles";
import { createScenarioRun, loadCreateEngine, type CreateEngine, type ScenarioRun } from "./scenarioRunner";
import type { Scenario } from "./types";

type Engine = { state: "loading" } | { state: "missing" } | { state: "ready"; create: CreateEngine };

const UI_FPS_MS = 100;

/**
 * Headless readout for a scenario: runs the real sim engine in a rAF loop and shows node states,
 * scripted checks and the event log. Stands in for the visual sim UI until that lands.
 */
export function SimReadout({ diagram, scenario, speed, seed, autoplay }: { diagram: DiagramFile; scenario: Scenario; speed: number; seed: number; autoplay: boolean }) {
  const [engine, setEngine] = useState<Engine>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    loadCreateEngine()
      .then((create) => alive && setEngine(create ? { state: "ready", create } : { state: "missing" }))
      .catch(() => alive && setEngine({ state: "missing" }));
    return () => {
      alive = false;
    };
  }, []);

  if (engine.state === "loading") return <div className="sim-readout is-empty">Loading the simulation engine…</div>;
  if (engine.state === "missing")
    return (
      <div className="sim-readout is-empty" data-testid="sim-unavailable">
        The simulation engine isn't available yet (<code>src/sim/engine.ts</code> → <code>createEngine</code>). The diagram above still renders.
      </div>
    );
  return <Runner create={engine.create} diagram={diagram} scenario={scenario} speed={speed} seed={seed} autoplay={autoplay} />;
}

function Runner({ create, diagram, scenario, speed, seed, autoplay }: { create: CreateEngine; diagram: DiagramFile; scenario: Scenario; speed: number; seed: number; autoplay: boolean }) {
  const runRef = useRef<ScenarioRun | null>(null);
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [snap, setSnap] = useState<SimSnapshot | null>(null);
  const [playing, setPlaying] = useState(autoplay);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  // (Re)create the run when the scenario, seed or a restart changes.
  useEffect(() => {
    try {
      const r = createScenarioRun(create, diagram, scenario, { seed, speed });
      runRef.current = r;
      setRun(r);
      setSnap(r.snapshot());
      setError(null);
      setPlaying(autoplay);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
    // speed is applied separately below so changing it doesn't restart the run
  }, [create, diagram, scenario, seed, autoplay, generation]);

  useEffect(() => runRef.current?.setSpeed(speed), [speed, run]);

  const guard = useCallback((fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (!playing || !run) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      guard(() => {
        const s = run.advance(dt);
        if (now - lastUi > UI_FPS_MS) {
          lastUi = now;
          setSnap({ ...s });
        }
        if (s.time >= run.duration) {
          setSnap({ ...s });
          setPlaying(false);
        }
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, run, guard]);

  if (error)
    return (
      <div className="sim-readout is-empty is-error" data-testid="sim-error">
        <strong>The engine threw:</strong> <code>{error}</code>
        <button className="btn" onClick={() => setGeneration((g) => g + 1)} data-testid="sim-restart">
          Restart
        </button>
      </div>
    );
  if (!run || !snap) return null;

  const checks = run.checks();
  const summary = checks.some((c) => c.status === "fail") ? "fail" : checks.every((c) => c.status === "pass") ? "pass" : "pending";
  const done = snap.time >= run.duration;
  const nodeIds = diagram.nodes.map((n) => n.id).filter((id) => snap.nodes[id]);
  const labelOf = new Map(diagram.nodes.map((n) => [n.id, n.label || n.id]));

  return (
    <div className="sim-readout" data-testid="sim-readout">
      <div className="sim-toolbar">
        <button className="btn btn-primary" onClick={() => setPlaying((p) => !p)} disabled={done && !playing} data-testid="sim-play">
          {playing ? "Pause" : done ? "Finished" : "Play"}
        </button>
        <button
          className="btn"
          onClick={() =>
            guard(() => {
              setSnap({ ...run.advance(1000 / speed) });
            })
          }
          data-testid="sim-step"
          title="Advance one second of simulation time"
        >
          +1s
        </button>
        <button
          className="btn"
          onClick={() =>
            guard(() => {
              setPlaying(false);
              setSnap({ ...run.fastForward() });
            })
          }
          data-testid="sim-fast-forward"
          title="Run to the end of the script instantly"
        >
          Run to end
        </button>
        <button className="btn" onClick={() => setGeneration((g) => g + 1)} data-testid="sim-restart">
          Restart
        </button>
        <div className="sim-clock mono" data-testid="sim-time" data-ms={Math.round(snap.time)}>
          {(snap.time / 1000).toFixed(1)}s <span>/ {(run.duration / 1000).toFixed(0)}s</span>
        </div>
        <div className="sim-stat mono" data-testid="sim-in-system">
          {snap.inSystem} in system · {snap.particles.length} particles
        </div>
        <div className={`sim-summary is-${summary}`} data-testid="sim-checks-summary" data-status={summary}>
          {checks.filter((c) => c.status === "pass").length}/{checks.length} checks
        </div>
      </div>

      <div className="sim-body">
        <div className="sim-table-wrap">
          <table className="sim-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Status</th>
                <th className="num">Backlog</th>
                <th className="num" title="In flight">Busy</th>
                <th className="num" title="Processed">Done</th>
                <th className="num" title="Failed attempts">Fail</th>
                <th className="num" title="Dead-lettered">DLQ</th>
                <th className="num" title="Dropped">Drop</th>
                <th className="num">msg/s</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nodeIds.map((id) => {
                const n = snap.nodes[id];
                const role = simRoleMeta[n.role] ?? simRoleMeta.none;
                const lag = Object.entries(n.lag).filter(([, v]) => v > 0);
                return (
                  <tr key={id} data-testid={`sim-node-${id}`} data-processed={n.processed} data-backlog={n.backlog}>
                    <td>
                      <div className="sim-node-name">{labelOf.get(id)}</div>
                      <div className="sim-node-id mono">
                        <i className="sim-role-dot" style={{ "--role": role.hue } as CSSProperties} title={role.hint} />
                        {role.label} · {id}
                      </div>
                    </td>
                    <td>
                      <select
                        className={`sim-status is-${n.status}`}
                        value={n.status}
                        onChange={(e) => guard(() => run.engine.setNodeStatus(id, e.target.value as NodeStatus))}
                        name={`status-${id}`}
                        aria-label={`Status of ${id}`}
                        data-testid={`sim-node-status-${id}`}
                      >
                        <option value="up">up</option>
                        <option value="paused">paused</option>
                        <option value="down">down</option>
                      </select>
                    </td>
                    <td className="num" title={lag.map(([g, v]) => `${g}: ${v}`).join("\n") || undefined}>
                      {n.backlog}
                      {lag.length > 1 && <span className="sim-lag"> ({lag.length} groups)</span>}
                    </td>
                    <td className="num">{n.inFlight}</td>
                    <td className="num">{n.processed}</td>
                    <td className={`num${n.failed ? " is-bad" : ""}`}>{n.failed}</td>
                    <td className={`num${n.deadLettered ? " is-warn" : ""}`}>{n.deadLettered}</td>
                    <td className={`num${n.dropped ? " is-warn" : ""}`}>{n.dropped}</td>
                    <td className="num">{n.throughput.toFixed(1)}</td>
                    <td>
                      <button className="link-btn" onClick={() => guard(() => run.engine.inject(id, 10))} data-testid={`sim-inject-${id}`} title="Inject 10 messages here">
                        +10
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="sim-side">
          <h4>Checks</h4>
          <ul className="sim-checks">
            {checks.map((c, i) => (
              <li key={i} className={`is-${c.status}`} data-testid={`sim-check-${i}`} data-status={c.status}>
                <i aria-hidden />
                <span>{c.label}</span>
                <span className="mono">@{(c.at / 1000).toFixed(1)}s</span>
              </li>
            ))}
          </ul>
          <h4>Events</h4>
          <ol className="sim-events mono" data-testid="sim-events">
            {snap.events
              .slice(-80)
              .reverse()
              .map((e, i) => (
                <li key={`${e.time}-${i}`} className={`ev-${e.kind}`}>
                  <span>{(e.time / 1000).toFixed(2)}</span> {e.text}
                </li>
              ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
