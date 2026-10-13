import type { ReactNode } from "react";
import type { EvidenceView } from "../../canvas/checks/simulationRuns";
import type { PlannedLoss } from "../evidence";

// Run simulations, in the Checks card (docs/research/architecture-checks.md, batch 5): one quiet line under the
// summary. Ready, it's a link; playing, it says which simulation it's on, with Stop (Esc stops it too); played, it says
// how many, what was lost on purpose, and Run again. The counts themselves are on the findings.

export interface SimulationsHost {
  view: EvidenceView;
  run(): void;
  stop(): boolean;
  /** A node's name as of the check. */
  name(id: string): string | undefined;
  /** Select a node and bring it into view (a planned loss names one; two can share a name). */
  reveal(ids: readonly string[]): void;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** "On purpose: 96 dropped at [Load balancer], which “Region outage” takes down." The node selects it. */
function planned(p: PlannedLoss, host: SimulationsHost): ReactNode {
  const n = p.count.toLocaleString("en-US");
  const node = (
    <button
      type="button"
      className="link-btn checks-sims-node"
      data-testid={`checks-planned-${p.node}`}
      title="Select it"
      onClick={() => host.reveal([p.node])}
    >
      {host.name(p.node) ?? p.node}
    </button>
  );
  const why =
    p.why === "down"
      ? `which “${p.simulation}” takes down`
      : p.why === "fails"
        ? `which “${p.simulation}” makes fail`
        : `as “${p.simulation}” expects`;
  return (
    <>
      On purpose: {n} {p.what === "dropped" ? "dropped at" : "left unread in"} {node}, {why}.
    </>
  );
}

const MAX_NOTES = 3;

export function SimulationsBar({ host }: { host: SimulationsHost }) {
  const v = host.view;
  if (v.status === "none") return null;
  const running = v.status === "running";
  let text: string;
  const notes: { key: string; body: ReactNode }[] = [];
  if (v.status === "running") text = `Playing ${v.index} of ${v.total}: “${v.title}”…`;
  else if (v.status === "ready")
    text =
      v.stopped === "edit"
        ? "Stopped: the diagram changed."
        : v.stopped === "failed"
          ? "Couldn't play the simulations."
          : v.stopped === "timeout"
            ? "Out of time: the simulations are too big to play here."
            : v.stopped === "unsupported"
              ? "This browser can't play them in the background, and the diagram is too big to play here."
              : v.stopped === "stop"
                ? "Stopped."
                : "";
  else if (v.stale) text = "The diagram changed since the simulations played.";
  else if (!v.played.length) {
    const what = v.unplayed.length + v.tooBig.length === 1 ? "simulation is" : "simulations are";
    text = v.unplayed.length ? `Out of time: the ${what} too big to play here.` : `The ${what} too big to play here.`;
  } else {
    const capped = v.played.filter((p) => p.capped).length;
    text = [
      `Played ${plural(v.played.length, "simulation")}`,
      capped ? `${capped === v.played.length && capped > 1 ? "each" : capped} stopped at a minute` : "",
      v.counted ? `counts on ${plural(v.counted, "finding")}` : v.planned.length ? "" : "no messages lost",
    ]
      .filter(Boolean)
      .join(" · ");
    for (const [i, p] of v.planned.slice(0, MAX_NOTES).entries())
      notes.push({ key: `planned-${i}`, body: planned(p, host) });
    if (v.planned.length > MAX_NOTES)
      notes.push({ key: "more", body: `And ${v.planned.length - MAX_NOTES} more on purpose.` });
    if (v.tooBig.length)
      notes.push({
        key: "too-big",
        body: `${v.tooBig.length === 1 ? `“${v.tooBig[0]}” starts` : `${v.tooBig.length} start`} too much traffic to play here: not counted.`,
      });
    if (v.unplayed.length)
      notes.push({
        key: "unplayed",
        body: `Out of time before ${v.unplayed.length === 1 ? `“${v.unplayed[0]}”` : `${v.unplayed.length} more`}: not counted.`,
      });
  }
  const label = running ? "Stop" : v.status === "done" ? "Run again" : "Run simulations";
  return (
    <div className="checks-sims" data-testid="checks-simulations" data-status={v.status}>
      <div className="checks-sims-row">
        {/* No spinner: anything animated in this blurred card repaints the canvas behind it every frame. */}
        <p className="checks-sims-text" role="status" aria-live="polite" data-testid="checks-simulations-status">
          {text}
        </p>
        {/* One button that changes its words, so focus stays on it from Run to Stop to Run again. */}
        <button
          key="action"
          type="button"
          className="link-btn checks-sims-action"
          data-testid={running ? "checks-stop-simulations" : "checks-run-simulations"}
          title={
            running
              ? "Stop playing (Esc)"
              : "Play the saved simulations here, a minute of each at most, and count the messages they lose"
          }
          onClick={() => (running ? host.stop() : host.run())}
        >
          {label}
        </button>
      </div>
      {notes.length > 0 && (
        <ul className="checks-sims-notes" data-testid="checks-simulations-notes">
          {notes.map((n) => (
            <li key={n.key}>{n.body}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
