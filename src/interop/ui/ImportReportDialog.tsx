import { useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Glyph } from "./glyphs";
import { toast } from "./toast";
import { paletteHost } from "../../palette/host";
import { getStencil, stencils } from "../../stencils/registry";
import { searchStencils } from "../../lib/stencilSearch";
import { swapStencil } from "../../ai/ui/apply";
import type { ImportReport, ReportGuess } from "../infra/graph";

// The Import report (docs/research/imports.md § UX): what the import drew as a guess (with one-click stencil
// chips), the connections it found in settings and the variable behind each, what it chose not to draw and
// what it couldn't read. Nothing is dropped silently. It lives in memory while the diagram stays open.

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** "Drew 15 nodes, 17 connections and 2 boundaries." */
function drewLine(r: Pick<ImportReport, "nodes" | "connections" | "boundaries">): string {
  const parts = [plural(r.nodes, "node"), plural(r.connections, "connection")];
  if (r.boundaries) parts.push(plural(r.boundaries, "boundary", "boundaries"));
  return `Drew ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}.`;
}

const editor = () => paletteHost.get().canvas?.editor ?? null;
let swaps = 0;

export function ImportReportDialog({
  report,
  isPrivate,
  onMakePrivate,
  onClose,
}: {
  report: ImportReport;
  /** Is the diagram private now (asked at each render)? */
  isPrivate: () => boolean;
  onMakePrivate: () => void;
  onClose: () => void;
}) {
  const [, rerender] = useState(0);
  const [madePrivate, setMadePrivate] = useState(false);
  const select = (nodeId: string) => {
    const host = paletteHost.get().canvas;
    if (!host?.editor.getNode(nodeId)) return toast.error("That node isn't in the diagram any more.");
    onClose();
    host.focusNode(nodeId);
  };
  const swap = (nodeId: string, stencilId: string) => {
    const ed = editor();
    if (!ed?.getNode(nodeId)) return toast.error("That node isn't in the diagram any more.");
    const plan = swapStencil(ed.getDiagram(), nodeId, stencilId);
    if (!plan.ok) return toast.error(plan.error.error);
    ed.applyDiagram(plan.next, { merge: `import:swap:${++swaps}` });
    rerender((n) => n + 1);
  };
  const name = (nodeId: string, label: string, testId: string) => (
    <button className="link-btn ix-report-name" onClick={() => select(nodeId)} data-testid={testId} title="Select it">
      {label}
    </button>
  );
  const privateNow = madePrivate || isPrivate();
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
                    setMadePrivate(true);
                  }}
                  data-testid="import-report-make-private"
                >
                  Make it private
                </button>
              </>
            )}
          </span>
          <span className="ix-grow" />
          <button className="btn btn-primary" onClick={onClose} data-autofocus data-testid="import-report-done">
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
        {report.guesses.length > 0 && (
          <Section title="Check these guesses" count={report.guesses.length} testId="import-report-guesses">
            {report.guesses.map((g, i) => (
              <GuessRow key={g.nodeId} guess={g} index={i} name={name} onSwap={swap} />
            ))}
          </Section>
        )}
        {report.inferred.length > 0 && (
          <Section title="Connections found in settings" count={report.inferred.length} testId="import-report-settings">
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
                <code className="ix-report-why">{c.evidence}</code>
              </li>
            ))}
          </Section>
        )}
        {report.notDrawn.length > 0 && (
          <Section title="Not drawn" count={report.notDrawn.length} testId="import-report-not-drawn">
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
                <span className="ix-report-what">{l.name}</span>
                <span className="ix-report-why">{l.reason}</span>
              </li>
            ))}
          </Section>
        )}
      </div>
    </Dialog>
  );
}

function Section({
  title,
  count,
  testId,
  children,
}: {
  title: string;
  count: number;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="ix-report-section" data-testid={testId}>
      <h3>
        {title} <span className="ix-report-count">({count})</span>
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

function GuessRow({
  guess,
  index,
  name,
  onSwap,
}: {
  guess: ReportGuess;
  index: number;
  name: (nodeId: string, label: string, testId: string) => ReactNode;
  onSwap: (nodeId: string, stencilId: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // The node's stencil now (a chip, the inspector or Undo may have changed it), else the import's pick.
  const current = editorNode(guess.nodeId)?.stencil ?? guess.stencil;
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
      onClick={() => {
        onSwap(guess.nodeId, id);
        setSearching(false);
        setQuery("");
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
            className="ix-report-chip is-other"
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

const editorNode = (id: string) => editor()?.getNode(id);
