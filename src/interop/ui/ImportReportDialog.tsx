import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Glyph } from "./glyphs";
import { toast } from "./toast";
import { paletteHost } from "../../palette/host";
import { getStencil, stencils } from "../../stencils/registry";
import { searchStencils } from "../../lib/stencilSearch";
import { DIAGRAMS_CHANGED } from "../../lib/diagramIO";
import type { ImportGraph, ImportPick, ImportReport, ReportGuess } from "../infra/graph";
import type { ImportOutcome } from "../formats";
import { MAX_DRAWN, pickedNodes } from "../infra/pick";

// The Import report (docs/research/imports.md § UX): what the import drew as a guess (with one-click stencil
// chips), the connections it found in settings and the variable behind each, what it chose not to draw and
// what it couldn't read. Nothing is dropped silently: a Terraform import can be drawn again with every resource. It lives in memory while the diagram stays open.

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** "Drew 15 nodes, 17 connections and 2 boundaries." */
function drewLine(r: Pick<ImportReport, "nodes" | "connections" | "boundaries">): string {
  const parts = [plural(r.nodes, "node"), plural(r.connections, "connection")];
  if (r.boundaries) parts.push(plural(r.boundaries, "boundary", "boundaries"));
  return `Drew ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}.`;
}

const editor = () => paletteHost.get().canvas?.editor ?? null;

/**
 * Draw everything, or a big import's picked boundaries: the import drawn again by the importers' lazy chunk, opened
 * as a new diagram, and the keyboard focus handed to its canvas once it's there (the control that asked for it is
 * gone with the dialog).
 */
async function drawAgain(
  draw: (pipeline: typeof import("../infra/pipeline")) => ImportOutcome,
  open: (outcome: ImportOutcome) => void,
  close: () => void,
) {
  let outcome: ImportOutcome;
  try {
    outcome = draw(await import("../infra/pipeline"));
  } catch (err) {
    outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  close();
  open(outcome);
  if (outcome.ok !== true) return;
  const title = outcome.diagram.title;
  let frames = 60;
  const focus = () => {
    const wrap = document.querySelector<HTMLElement>(".canvas-wrap");
    if (wrap && editor()?.getDiagram().title === title) {
      wrap.focus({ preventScroll: true });
      if (document.activeElement === wrap) return;
    }
    if (--frames > 0) requestAnimationFrame(focus);
  };
  requestAnimationFrame(focus);
}
let swaps = 0;

/**
 * An address or a path ("module.streaming.aws_lambda_event_source_mapping.analytics", `module.queues["eu"]`) that
 * wraps between its parts, after "." and "/" and before "[", never inside a name. `<wbr>` adds no text, so it still
 * copies as one string.
 */
function Breakable({ text }: { text: string }) {
  // One span, so a flex row (a report name) sees one item, not one per part.
  return (
    <span>
      {text.split(/(?<=[./])|(?=\[)/).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

export function ImportReportDialog({
  report,
  isPrivate,
  onMakePrivate,
  replay,
  onReplay,
  onClose,
}: {
  report: ImportReport;
  /** Is the diagram private now (asked at each render)? */
  isPrivate: () => boolean;
  onMakePrivate: () => void;
  /** Terraform's Draw everything: the import with every resource as a node, as data read at import time. */
  replay?: ImportGraph;
  /** Opens the drawn replay as a new diagram (keeping this one's privacy). */
  onReplay?: (outcome: ImportOutcome) => void;
  onClose: () => void;
}) {
  const [, rerender] = useState(0);
  const done = useRef<HTMLButtonElement>(null);
  // Privacy is read from the document itself, and the report follows it as it changes (here or in another tab).
  useEffect(() => {
    const changed = () => rerender((n) => n + 1);
    window.addEventListener(DIAGRAMS_CHANGED, changed);
    return () => window.removeEventListener(DIAGRAMS_CHANGED, changed);
  }, []);
  const select = (nodeId: string) => {
    const host = paletteHost.get().canvas;
    if (!host?.editor.getNode(nodeId)) return toast.error("That node isn't in the diagram any more.");
    onClose();
    // Once the dialog has closed and the canvas is no longer inert, so the node can take the focus.
    window.setTimeout(() => paletteHost.get().canvas?.focusNode(nodeId), 0);
  };
  /** A chip: the editor's own stencil change, one undo step. */
  const swap = (nodeId: string, stencilId: string) => {
    const ed = editor();
    if (!ed?.getNode(nodeId)) return toast.error("That node isn't in the diagram any more.");
    ed.updateNode(nodeId, { stencil: stencilId }, { merge: `import:swap:${++swaps}` });
    rerender((n) => n + 1);
  };
  // One snapshot of the diagram per render, shared by every row.
  const current = new Map(
    editor()
      ?.getDiagram()
      .nodes.map((n) => [n.id, n.stencil]),
  );
  const name = (nodeId: string, label: string, testId: string) => (
    <button className="link-btn ix-report-name" onClick={() => select(nodeId)} data-testid={testId} title="Select it">
      {label}
    </button>
  );
  const privateNow = isPrivate();
  return (
    <Dialog
      title="Import report"
      subtitle={report.source}
      icon={<Glyph name="upload" />}
      onClose={onClose}
      testId="import-report"
      width={620}
      footer={
        <>
          <span className="ix-report-foot" data-testid="import-report-privacy">
            Read on this device. Nothing was uploaded.
            {!privateNow && (
              <>
                {" "}
                This diagram isn't private.{" "}
                <button
                  className="link-btn"
                  onClick={() => {
                    onMakePrivate();
                    rerender((n) => n + 1);
                    // The button goes once it worked: the focus stays in the dialog.
                    requestAnimationFrame(() => {
                      if (!document.activeElement || document.activeElement === document.body) done.current?.focus();
                    });
                  }}
                  data-testid="import-report-make-private"
                >
                  Make it private
                </button>
              </>
            )}
          </span>
          <span className="ix-grow" />
          <button
            ref={done}
            className="btn btn-primary"
            onClick={onClose}
            data-autofocus
            data-testid="import-report-done"
          >
            Done
          </button>
        </>
      }
    >
      <p className="ix-report-lede" data-testid="import-report-summary">
        {drewLine(report)}
      </p>
      {report.notes.map((note) => (
        <p key={note} className="ix-report-note" data-testid="import-report-note">
          {note}.
        </p>
      ))}
      <div className="ix-report">
        {report.pick && onReplay && (
          <PickSection
            pick={report.pick}
            onDraw={(keys) =>
              void drawAgain(
                (p) => p.replayOutcome(report.pick!.graph, report.pick!.format, keys, report.pick!.everything),
                onReplay,
                onClose,
              )
            }
          />
        )}
        {report.guesses.length > 0 && (
          <Section title="Check these guesses" count={report.guesses.length} testId="import-report-guesses">
            {report.guesses.map((g, i) => (
              <GuessRow
                key={g.nodeId}
                guess={g}
                index={i}
                current={current.get(g.nodeId) ?? g.stencil}
                name={name}
                onSwap={swap}
              />
            ))}
          </Section>
        )}
        {report.traffic && report.traffic.length > 0 && (
          // Where the saved simulation starts messages, and how fast: Go live and pick it to watch them flow.
          <Section title="Imported traffic" count={report.traffic.length} testId="import-report-traffic">
            {report.traffic.map((t, i) => (
              <li key={t.nodeId} className="ix-report-row" data-testid={`import-report-traffic-${i}`}>
                <span className="ix-report-what">
                  {name(t.nodeId, t.label, `import-report-traffic-name-${i}`)}
                  {t.messageType && <span className="ix-report-muted">{t.messageType}</span>}
                </span>
                <span className="ix-report-why">
                  {t.ratePerSec} msg/s for {t.seconds >= 60 ? `${t.seconds / 60} min` : `${t.seconds} s`}
                </span>
              </li>
            ))}
          </Section>
        )}
        {report.inferred.length > 0 && (
          <Section
            title={report.connectionsTitle ?? "Connections found in settings"}
            count={report.inferred.length}
            testId="import-report-settings"
          >
            {report.inferred.map((c, i) => (
              <li key={i} className="ix-report-row" data-testid={`import-report-setting-${i}`}>
                <span className="ix-report-what">
                  {name(c.fromId, c.from, `import-report-setting-from-${i}`)} →{" "}
                  {name(c.toId, c.to, `import-report-setting-to-${i}`)}
                  {c.note && (
                    <span className="ix-report-muted">
                      {" "}
                      ({c.note}
                      {c.guess ? ", a guess" : ""})
                    </span>
                  )}
                </span>
                <code className="ix-report-why text-selectable" data-testid={`import-report-setting-evidence-${i}`}>
                  <Breakable text={c.evidence} />
                </code>
              </li>
            ))}
          </Section>
        )}
        {report.notDrawn.length > 0 && (
          <Section
            title="Not drawn"
            count={report.notDrawn.length}
            testId="import-report-not-drawn"
            action={
              replay &&
              onReplay && (
                <button
                  className="link-btn ix-report-action"
                  onClick={() => void drawAgain((p) => p.replayOutcome(replay), onReplay, onClose)}
                  title="Opens a new diagram with every resource as a node"
                  data-testid="import-report-draw-everything"
                >
                  Draw everything
                </button>
              )
            }
          >
            {report.notDrawn.map((l, i) => (
              <li key={i} className="ix-report-row" data-testid={`import-report-not-drawn-${i}`}>
                <span className="ix-report-what">{l.name}</span>
                <span className="ix-report-why">{l.reason}</span>
              </li>
            ))}
          </Section>
        )}
        {report.unread.length > 0 && (
          <Section title="Couldn't read" count={report.unread.length} testId="import-report-unread">
            {report.unread.map((l, i) => (
              <li key={i} className="ix-report-row" data-testid={`import-report-unread-${i}`}>
                <span className="ix-report-what text-selectable">
                  <Breakable text={l.name} />
                </span>
                <span className="ix-report-why">{l.reason}</span>
              </li>
            ))}
          </Section>
        )}
      </div>
    </Dialog>
  );
}

/**
 * A big import, drawn in part: every boundary with its nodes and flows, the drawn ones ticked, and one button to
 * draw the ticked ones as a new diagram (this one stays as it is).
 */
function PickSection({ pick, onDraw }: { pick: ImportPick; onDraw: (keys: string[]) => void }) {
  const [chosen, setChosen] = useState(() => new Set(pick.groups.filter((g) => g.drawn).map((g) => g.key)));
  const keys = pick.groups.filter((g) => chosen.has(g.key)).map((g) => g.key);
  const count = pickedNodes(pick.graph, keys);
  const same =
    keys.length === pick.groups.filter((g) => g.drawn).length &&
    pick.groups.every((g) => g.drawn === chosen.has(g.key));
  const statusId = useId();
  const over = count > MAX_DRAWN;
  const unavailable = !keys.length || over || same;
  const toggle = (key: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <section className="ix-report-section" data-testid="import-report-pick">
      <h3>
        Boundaries{" "}
        <span className="ix-report-count">
          ({pick.groups.filter((g) => g.drawn).length.toLocaleString("en")} of {pick.groups.length.toLocaleString("en")}{" "}
          drawn)
        </span>
      </h3>
      <p className="ix-report-note" data-testid="import-report-pick-lede">
        It has {pick.total.toLocaleString("en")} nodes, more than a diagram reads well, so only some boundaries are
        drawn. The ones with the most flows come first; tick others to draw them as a new diagram.
      </p>
      <ul className="ix-report-pick-list" data-testid="import-report-pick-list">
        {pick.groups.map((g, i) => (
          <li key={g.key} className="ix-report-row" data-testid={`import-report-pick-row-${i}`}>
            <label className="ix-check ix-report-what">
              <input
                type="checkbox"
                checked={chosen.has(g.key)}
                onChange={(e) => toggle(g.key, e.target.checked)}
                aria-describedby={statusId}
                data-testid={`import-report-pick-${i}`}
              />
              <Breakable text={g.label} />
            </label>
            <span className="ix-report-why">
              {g.nodes.toLocaleString("en")} {g.nodes === 1 ? "node" : "nodes"} · {g.flows.toLocaleString("en")}{" "}
              {g.flows === 1 ? "flow" : "flows"}
            </span>
          </li>
        ))}
      </ul>
      <div className="ix-report-pick-foot">
        {/* Unavailable rather than disabled: it stays in the Tab order, and says why with the status beside it. */}
        <button
          className="btn"
          aria-disabled={unavailable || undefined}
          aria-describedby={statusId}
          onClick={() => {
            if (!unavailable) onDraw(keys);
          }}
          title="Opens a new diagram with the ticked boundaries; this one stays as it is"
          data-testid="import-report-pick-draw"
        >
          Draw these ({count.toLocaleString("en")} {count === 1 ? "node" : "nodes"})
        </button>
        {/* Announced as the ticks change: the total, and why the button is unavailable when it is. */}
        <span
          id={statusId}
          role="status"
          className={over ? "ix-report-pick-status is-over" : "ix-report-pick-status"}
          data-testid="import-report-pick-status"
        >
          {over
            ? `${count.toLocaleString("en")} nodes ticked, over the ${MAX_DRAWN.toLocaleString("en")} an import draws: untick some.`
            : !keys.length
              ? "Nothing ticked."
              : same
                ? `${count.toLocaleString("en")} nodes ticked: these are drawn.`
                : `${count.toLocaleString("en")} nodes ticked.`}
        </span>
      </div>
    </section>
  );
}

function Section({
  title,
  count,
  testId,
  action,
  children,
}: {
  title: string;
  count: number;
  testId: string;
  /** One quiet action beside the heading (Terraform's Draw everything). */
  action?: ReactNode;
  children: ReactNode;
}) {
  const heading = (
    <h3>
      {title} <span className="ix-report-count">({count})</span>
    </h3>
  );
  return (
    <section className="ix-report-section" data-testid={testId}>
      {action ? (
        <div className="ix-report-head">
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      <ul>{children}</ul>
    </section>
  );
}

function GuessRow({
  guess,
  index,
  current,
  name,
  onSwap,
}: {
  guess: ReportGuess;
  index: number;
  /** The node's stencil now (a chip, the inspector or Undo may have changed it). */
  current: string;
  name: (nodeId: string, label: string, testId: string) => ReactNode;
  onSwap: (nodeId: string, stencilId: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const other = useRef<HTMLButtonElement>(null);
  const chips = [...new Set([guess.stencil, ...guess.alternatives])].filter((id) => id !== current);
  const found = query.trim()
    ? searchStencils(stencils, query)
        .filter((s) => s.id !== current && !chips.includes(s.id))
        .slice(0, 6)
    : [];
  const chip = (id: string, testId: string) => (
    <button
      key={testId}
      className="ix-report-chip"
      // The visible name first, then which node it changes: two rows may show the same stencil.
      aria-label={`${getStencil(id).label} for ${guess.label}`}
      onClick={() => {
        onSwap(guess.nodeId, id);
        setSearching(false);
        setQuery("");
        // The chip just used goes away: keep the focus in this row (the dialog keeps its keys).
        requestAnimationFrame(() => other.current?.focus());
      }}
      data-testid={testId}
    >
      {getStencil(id).label}
    </button>
  );
  return (
    <li className="ix-report-row ix-report-guess" data-testid={`import-report-guess-${index}`}>
      <span className="ix-report-what">
        {name(guess.nodeId, guess.label, `import-report-guess-name-${index}`)}
        <span className="ix-report-stencil" data-testid={`import-report-guess-stencil-${index}`}>
          {getStencil(current).label}
        </span>
        {guess.evidence && <span className="ix-report-muted ix-report-evidence">{guess.evidence}</span>}
      </span>
      <span className="ix-report-chips">
        {chips.map((id) => chip(id, `import-report-chip-${index}-${id}`))}
        {searching ? (
          <input
            className="ix-input ix-report-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stencils"
            aria-label={`Another stencil for ${guess.label}`}
            ref={(el) => el?.focus()}
            data-testid={`import-report-search-${index}`}
          />
        ) : (
          <button
            ref={other}
            className="ix-report-chip is-other"
            aria-label={`Other stencil for ${guess.label}`}
            onClick={() => setSearching(true)}
            data-testid={`import-report-other-${index}`}
          >
            Other…
          </button>
        )}
        {found.map((s) => chip(s.id, `import-report-found-${index}-${s.id}`))}
      </span>
    </li>
  );
}
