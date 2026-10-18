import { useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { safeStorage } from "../../lib/storage";

export const OPEN_KEY = "diagrams.inspector.open.v1";

export function readOpen(): Record<string, boolean> {
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
  aside,
  count,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen()[id] === true);
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
          onClick={toggle}
          data-testid={`inspector-section-${id}`}
        >
          <Icon name="chevron-right" size={12} />
          {title}
          {!!count && <span className="insp-count">{count}</span>}
        </button>
        {aside}
      </h3>
      {open && children}
    </section>
  );
}
