import { useId, useState, type ReactNode } from "react";
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
}: {
  id: string;
  title: string;
  description?: string;
  aside?: ReactNode;
  count?: number;
  children: ReactNode;
  /** An explicit field-focus request opens its section before the first focus pass. */
  reveal?: number;
}) {
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
          aria-describedby={open && description ? descriptionId : undefined}
          onClick={toggle}
          data-testid={`inspector-section-${id}`}
        >
          <Icon name="chevron-right" size={12} />
          {title}
          {!!count && <span className="insp-count">{count}</span>}
        </button>
        {aside}
      </h3>
      {open &&
        (description ? (
          <div
            className="insp-request-content"
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
        ))}
    </section>
  );
}
