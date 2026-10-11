import type { CSSProperties } from "react";
import { getStencil } from "../stencils/registry";
import { StencilIcon } from "../components/StencilIcon";
import { Icon } from "../components/Icon";

export interface StartExample {
  slug: string;
  title: string;
  description?: string;
  /** A few stencil ids from the diagram, shown as a tiny preview of what's inside. */
  stencils: string[];
}

export interface StartOptions {
  examples: StartExample[];
  onExample: (slug: string) => void;
  onOpenFile: () => void;
  onPaste: () => void;
}

/**
 * The empty state of a blank diagram, and the first screen a new visitor sees: what this is, and
 * three ways in (an example, a blank canvas, or a file from another tool). No modal, no tour: it
 * sits on the canvas and disappears as soon as there's a node.
 */
export function StartCard({ start, onBlank }: { start: StartOptions; onBlank: () => void }) {
  return (
    <section className="start-card" data-testid="start-card" aria-labelledby="start-card-title">
      <h2 id="start-card-title">Draw a system, then watch messages flow through it</h2>
      <p className="start-lede">Open an example to explore, or start from a blank canvas.</p>

      <ul className="start-examples" aria-label="Examples">
        {start.examples.map((ex) => (
          <li key={ex.slug}>
            <button
              className="start-example"
              onClick={() => start.onExample(ex.slug)}
              data-testid={`start-example-${ex.slug}`}
            >
              <span className="start-tiles" aria-hidden>
                {ex.stencils.map((id) => {
                  const st = getStencil(id);
                  return (
                    <span key={id} className="palette-tile" style={{ "--accent": st.accent } as CSSProperties}>
                      <StencilIcon stencil={st} size={15} />
                    </span>
                  );
                })}
              </span>
              <span className="start-example-text">
                <strong>{ex.title}</strong>
                {ex.description && <span>{ex.description}</span>}
              </span>
              <Icon name="chevron-right" size={14} />
            </button>
          </li>
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
