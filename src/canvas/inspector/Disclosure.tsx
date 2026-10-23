import { useId, useState, type ReactNode } from "react";
import { formatCount } from "../../live/format";
import { Icon } from "../../components/Icon";
import { safeStorage } from "../../lib/storage";

const OPEN_KEY = "diagrams.inspector.open.v1";

function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(safeStorage.getItem(OPEN_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** A collapsed-by-default section; it stays open once you've opened it (per browser). */
export function Disclosure({
  id,
  title,
  description,
  aside,
  count,
  children,
  reveal,
  summary,
}: {
  id: string;
  title: string;
  description?: string;
  aside?: ReactNode;
  count?: number;
  children: ReactNode;
  /** An explicit field-focus request opens its section before the first focus pass. */
  reveal?: number;
  summary?: string;
}) {
  const summaryId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(() => reveal !== undefined || readOpen()[id] === true);
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== undefined && reveal !== revealed) {
    setRevealed(reveal);
    if (!open) setOpen(true);
  }
  const toggle = () => {
    setOpen(!open);
    safeStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: !open }));
  };
  return (
    <section className={`insp-section insp-disclosure${open ? " is-open" : ""}`}>
      <h3>
        <button
          type="button"
          className="insp-disclosure-head"
          aria-expanded={open}
          aria-describedby={open && description ? descriptionId : !open && summary ? summaryId : undefined}
          onClick={toggle}
          data-testid={`inspector-section-${id}`}
        >
          <span className="insp-disclosure-title">{title}</span>
          {!!count && (
            <span className="insp-count" title={String(count)}>
              {formatCount(count)}
            </span>
          )}
          {aside}
          <Icon name="chevron-right" size={12} />
        </button>
      </h3>
      {!open && summary && (
        <p id={summaryId} className="insp-summary" data-testid={`inspector-summary-${id}`}>
          {summary}
        </p>
      )}
      {open && (
        <div className="insp-section-body" data-testid={`inspector-body-${id}`}>
          {description ? (
            <div
              className="insp-section-body insp-request-content"
              role="group"
              data-testid={`inspector-content-${id}`}
              aria-describedby={descriptionId}
            >
              <p id={descriptionId} className="insp-note">
                {description}
              </p>
              {children}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
