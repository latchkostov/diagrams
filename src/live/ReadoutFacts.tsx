import type { ReactNode } from "react";
import "../styles/readout.css";

/** Label/value facts shared by the docked readout sections. */
export function ReadoutFacts({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="inspector-live-outcomes" data-testid="readout-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
