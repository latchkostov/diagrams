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
        {summary && (
          <span className="readout-summary" id={description} aria-hidden data-testid={`${testId}-summary`}>
            {summary}
          </span>
        )}
        <Icon name="chevron-right" size={12} />
      </summary>
      <div className="readout-disclosure-body" data-testid={`${testId}-body`}>
        {children}
      </div>
    </details>
  );
}
