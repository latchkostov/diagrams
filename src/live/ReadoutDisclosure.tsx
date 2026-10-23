import { useId, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import "../styles/readout.css";

/** The same quiet disclosure row for Live explanations and Inspector subgroups. */
export function ReadoutDisclosure({
  title,
  testId,
  toggleId = `${testId}-toggle`,
  open,
  children,
  summary,
}: {
  title: string;
  testId: string;
  toggleId?: string;
  open?: boolean;
  children: ReactNode;
  summary?: string;
}) {
  const description = useId();
  return (
    <details className="readout-disclosure" data-testid={testId} open={open}>
      <summary className="readout-row" data-testid={toggleId} aria-describedby={summary ? description : undefined}>
        <span>{title}</span>
        <Icon name="chevron-right" size={12} />
      </summary>
      {summary && (
        <p className="readout-summary" id={description} data-testid={`${testId}-summary`}>
          {summary}
        </p>
      )}
      <div className="insp-section-body">{children}</div>
    </details>
  );
}
