import { surfaceCatalogs } from "../../i18n/surfaces";
import { formatImportMessage } from "./importMessages";
import { formatNumber, formatImportTraffic } from "../../i18n/format";
import { t as tr, useLocale } from "../../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Glyph } from "./glyphs";
import { toast } from "./toast";
import { paletteHost } from "../../palette/host";
import { getStencil, stencils } from "../../stencils/registry";
import { searchStencils } from "../../lib/stencilDisplaySearch";
import { stencilLabel } from "../../i18n/stencils";
import { DIAGRAMS_CHANGED } from "../../lib/diagramIO";
import { newDiagramsPrivate, useNewDiagramsPrivate } from "../../lib/privacyPrefs";
import { safeStorage } from "../../lib/storage";
import type { ImportGraph, ImportReport, ReportGuess } from "../infra/graph";
import type { ImportOutcome } from "../formats";
import { Breakable } from "./Breakable";
import { ImportPickSection } from "./ImportPickSection";

// The Import report (docs/research/imports.md § UX): what the import drew as a guess (with one-click stencil
// chips), the connections it found in settings and the variable behind each, what it chose not to draw and
// what it couldn't read. Nothing is dropped silently: a Terraform import can be drawn again with every resource. It lives in memory while the diagram stays open.

/**
 * Set once an Import report has offered **New diagrams are private** (the first infrastructure import whose report
 * is opened): it's asked once, never again. Clear everything forgets it with every other app key.
 */
const PRIVATE_OFFERED_KEY = "diagrams.newDiagramsPrivateOffered.v1";

/** The counts are one sentence, so each language chooses its order and plurals. */
function drewLine(r: Pick<ImportReport, "nodes" | "connections" | "boundaries">): string {
  return tr("importReport.drew", r);
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
  useLocale();
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
    if (!host?.editor.getNode(nodeId)) return toast.error(tr("importReport.thatNodeIsntInTheDiagramAny"));
    onClose();
    // Once the dialog has closed and the canvas is no longer inert, so the node can take the focus.
    window.setTimeout(() => paletteHost.get().canvas?.focusNode(nodeId), 0);
  };
  /** A chip: the editor's own stencil change, one undo step. */
  const swap = (nodeId: string, stencilId: string) => {
    const ed = editor();
    if (!ed?.getNode(nodeId)) return toast.error(tr("importReport.thatNodeIsntInTheDiagramAny"));
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
    <button
      className="link-btn ix-report-name"
      onClick={() => select(nodeId)}
      data-testid={testId}
      title={tr("importReport.selectIt")}
    >
      {label}
    </button>
  );
  const privateNow = isPrivate();
  // Ask about Private when it matters: the first report offers New diagrams are private, beside Make it private.
  // Only while it's off, and once: it never turns on by itself (Private turns AI off, so it stays a choice).
  const [offer] = useState(() => !newDiagramsPrivate.get() && safeStorage.getItem(PRIVATE_OFFERED_KEY) !== "1");
  useEffect(() => {
    if (offer) safeStorage.setItem(PRIVATE_OFFERED_KEY, "1");
  }, [offer]);
  const newPrivate = useNewDiagramsPrivate();
  return (
    <Dialog
      title={tr("importReport.importReport")}
      subtitle={report.source}
      icon={<Glyph name="upload" />}
      onClose={onClose}
      testId="import-report"
      width={620}
      footer={
        <>
          <span className="ix-report-foot" data-testid="import-report-privacy">
            {tr("importReport.readOnThisDeviceNothingWasUploaded")}
            {!privateNow && (
              <>
                {" "}
                {tr("importReport.thisDiagramIsntPrivate")}{" "}
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
                  {tr("importReport.makeItPrivate")}
                </button>
              </>
            )}
            {offer && (
              <label className="ix-report-offer" data-testid="import-report-offer">
                <input
                  type="checkbox"
                  checked={newPrivate}
                  onChange={(e) => newDiagramsPrivate.set(e.target.checked)}
                  data-testid="import-report-new-private"
                />
                {tr("privacy.newDiagrams")}
                <span className="ix-report-offer-where">{tr("importReport.filePrivacy")}</span>
              </label>
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
            {tr("common.done")}
          </button>
        </>
      }
    >
      <p className="ix-report-lede" data-testid="import-report-summary">
        {drewLine(report)}
      </p>
      {report.notes.map((note) => (
        <p key={JSON.stringify(note)} className="ix-report-note" data-testid="import-report-note">
          {formatImportMessage(note)}.
        </p>
      ))}
      <div className="ix-report">
        {report.pick && onReplay && (
          <ImportPickSection
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
          <Section
            title={tr("importReport.checkTheseGuesses")}
            count={report.guesses.length}
            testId="import-report-guesses"
          >
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
          <Section
            title={tr("importReport.importedTraffic")}
            count={report.traffic.length}
            testId="import-report-traffic"
          >
            {report.traffic.map((t, i) => (
              <li key={t.nodeId} className="ix-report-row" data-testid={`import-report-traffic-${i}`}>
                <span className="ix-report-what">
                  {name(t.nodeId, t.label, `import-report-traffic-name-${i}`)}
                  {t.messageType && <span className="ix-report-muted">{t.messageType}</span>}
                </span>
                <span className="ix-report-why">
                  {tr("importReport.trafficDuration", formatImportTraffic(t.ratePerSec, t.seconds))}
                </span>
              </li>
            ))}
          </Section>
        )}
        {report.inferred.length > 0 && (
          <Section
            title={
              report.connectionsTitle
                ? formatImportMessage(report.connectionsTitle)
                : tr("importReport.connectionsFoundInSettings")
            }
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
                      ({formatImportMessage(c.note)}
                      {c.guess ? tr("importReport.aGuess") : ""})
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
            title={tr("importReport.notDrawn")}
            count={report.notDrawn.length}
            testId="import-report-not-drawn"
            action={
              replay &&
              onReplay && (
                <button
                  className="link-btn ix-report-action"
                  onClick={() => void drawAgain((p) => p.replayOutcome(replay), onReplay, onClose)}
                  title={tr("importReport.opensANewDiagramWithEveryResource")}
                  data-testid="import-report-draw-everything"
                >
                  {tr("importReport.drawEverything")}
                </button>
              )
            }
          >
            {report.notDrawn.map((l, i) => (
              <li key={i} className="ix-report-row" data-testid={`import-report-not-drawn-${i}`}>
                <span className="ix-report-what">{formatImportMessage(l.name)}</span>
                <span className="ix-report-why">{formatImportMessage(l.reason)}</span>
              </li>
            ))}
          </Section>
        )}
        {report.unread.length > 0 && (
          <Section title={tr("importReport.couldntRead")} count={report.unread.length} testId="import-report-unread">
            {report.unread.map((l, i) => (
              <li key={i} className="ix-report-row" data-testid={`import-report-unread-${i}`}>
                <span className="ix-report-what text-selectable">
                  <Breakable text={formatImportMessage(l.name)} />
                </span>
                <span className="ix-report-why">{formatImportMessage(l.reason)}</span>
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
      {title} <span className="ix-report-count">({formatNumber(count)})</span>
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
      aria-label={tr("importReport.stencilFor", { stencil: stencilLabel(getStencil(id)), name: guess.label })}
      onClick={() => {
        onSwap(guess.nodeId, id);
        setSearching(false);
        setQuery("");
        // The chip just used goes away: keep the focus in this row (the dialog keeps its keys).
        requestAnimationFrame(() => other.current?.focus());
      }}
      data-testid={testId}
    >
      {stencilLabel(getStencil(id))}
    </button>
  );
  return (
    <li className="ix-report-row ix-report-guess" data-testid={`import-report-guess-${index}`}>
      <span className="ix-report-what">
        {name(guess.nodeId, guess.label, `import-report-guess-name-${index}`)}
        <span className="ix-report-stencil" data-testid={`import-report-guess-stencil-${index}`}>
          {stencilLabel(getStencil(current))}
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
            placeholder={tr("importReport.searchStencils")}
            aria-label={tr("importReport.anotherStencil", { name: guess.label })}
            ref={(el) => el?.focus()}
            data-testid={`import-report-search-${index}`}
          />
        ) : (
          <button
            ref={other}
            className="ix-report-chip is-other"
            aria-label={tr("importReport.otherStencil", { name: guess.label })}
            onClick={() => setSearching(true)}
            data-testid={`import-report-other-${index}`}
          >
            {tr("importReport.other")}
          </button>
        )}
        {found.map((s) => chip(s.id, `import-report-found-${index}-${s.id}`))}
      </span>
    </li>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- optional strings share the component download lifecycle
export async function reportWhenReady() {
  await surfaceCatalogs(["stencils"]);
  return ImportReportDialog;
}
