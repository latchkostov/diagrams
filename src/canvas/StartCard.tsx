import { Icon } from "../components/Icon";
import { DiagramThumbnail } from "../components/DiagramThumbnail";
import type { Thumb } from "../lib/thumbnail";

export interface StartExample {
  slug: string;
  title: string;
  description?: string;
  /** A tiny rendering of the diagram (the same renderer as Your diagrams). */
  thumb: Thumb;
}

export interface StartRecent {
  slug: string;
  title: string;
  /** e.g. "12 nodes · edited 5 min ago". */
  detail: string;
  thumb: Thumb;
}

export interface StartOptions {
  /** Your diagrams, most recent first (the open one excluded). */
  recent: StartRecent[];
  examples: StartExample[];
  /** Opens a diagram (yours or an example) by slug. */
  onOpen: (slug: string) => void;
  onOpenFile: () => void;
  onPaste: () => void;
  /** Opens the full "Your diagrams" list. */
  onLibrary: () => void;
}

/** Recent diagrams shown on the card; the rest are one click away in Your diagrams. */
const RECENT_MAX = 3;

/**
 * The empty state of a blank diagram, and the first screen a new visitor sees: what this is, and
 * the ways in (your recent diagrams, an example, a blank canvas, or a file from another tool). No
 * modal, no tour: it sits on the canvas and disappears as soon as there's a node.
 */
export function StartCard({ start, onBlank }: { start: StartOptions; onBlank: () => void }) {
  const recent = start.recent.slice(0, RECENT_MAX);
  return (
    <section className="start-card" data-testid="start-card" aria-labelledby="start-card-title">
      <h2 id="start-card-title">Draw a system, then watch messages flow through it</h2>
      <p className="start-lede">
        {recent.length
          ? "Pick up where you left off, open an example, or start from a blank canvas."
          : "Open an example to explore, or start from a blank canvas."}
      </p>

      {recent.length > 0 && (
        <>
          <div className="start-heading">
            <h3>Your diagrams</h3>
            {start.recent.length > RECENT_MAX && (
              <button className="link-btn" onClick={start.onLibrary} data-testid="start-library">
                All {start.recent.length}
              </button>
            )}
          </div>
          <ul className="start-examples" aria-label="Your diagrams">
            {recent.map((d) => (
              <StartRow
                key={d.slug}
                testId={`start-recent-${d.slug}`}
                title={d.title}
                detail={d.detail}
                thumb={d.thumb}
                onClick={() => start.onOpen(d.slug)}
              />
            ))}
          </ul>
          <div className="start-heading">
            <h3>Examples</h3>
          </div>
        </>
      )}

      <ul className="start-examples" aria-label="Examples">
        {start.examples.map((ex) => (
          <StartRow
            key={ex.slug}
            testId={`start-example-${ex.slug}`}
            title={ex.title}
            detail={ex.description}
            thumb={ex.thumb}
            onClick={() => start.onOpen(ex.slug)}
          />
        ))}
      </ul>

      <div className="start-actions">
        <button className="btn" onClick={onBlank} data-testid="start-blank">
          <Icon name="plus" size={14} /> Start blank
        </button>
        <button className="btn btn-ghost" onClick={start.onOpenFile} data-testid="start-open">
          <Icon name="upload" size={14} /> Open a file…
        </button>
        <button className="btn btn-ghost" onClick={start.onPaste} data-testid="start-paste">
          <Icon name="paste" size={14} /> Paste text…
        </button>
      </div>
      <p className="start-note">Opens diagram files, draw.io and Mermaid. You can also drop a file anywhere.</p>
    </section>
  );
}

function StartRow(p: { testId: string; title: string; detail?: string; thumb: Thumb; onClick: () => void }) {
  return (
    <li>
      <button className="start-example" onClick={p.onClick} data-testid={p.testId}>
        <span className="start-thumb">
          <DiagramThumbnail thumb={p.thumb} testId={`${p.testId}-thumb`} />
        </span>
        <span className="start-example-text">
          <strong>{p.title}</strong>
          {p.detail && <span>{p.detail}</span>}
        </span>
        <Icon name="chevron-right" size={14} />
      </button>
    </li>
  );
}
