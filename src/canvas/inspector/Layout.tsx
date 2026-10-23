import type { HTMLAttributes, ReactNode, Ref } from "react";
import "../../styles/inspector-layout.css";

/** Short fields keep their DOM / keyboard order, and stack below a 320px sheet. */
export function PairedFields({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="insp-paired" data-testid={testId}>
      {children}
    </div>
  );
}

/** A labelled set of independent choices, rather than several controls inside a label. */
export function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="insp-fieldset">
      <legend className="insp-label">{legend}</legend>
      <div className="insp-paired">{children}</div>
    </fieldset>
  );
}

/** One nesting level, including when subgroups contain other disclosures. */
export function Subgroup({
  title,
  children,
  ref,
  testId,
  ...semantics
}: {
  title?: string;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
  testId?: string;
} & Pick<HTMLAttributes<HTMLDivElement>, "role" | "aria-labelledby" | "aria-describedby">) {
  return (
    <div {...semantics} className="insp-subgroup" ref={ref} data-testid={testId}>
      {title && <h4>{title}</h4>}
      {children}
    </div>
  );
}
