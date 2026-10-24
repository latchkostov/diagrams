import { useId, type ReactNode } from "react";
import { Subgroup } from "./Layout";

/** Group descriptions remain visible and are announced when its controls are reached. */
export function RequestGroup({
  name,
  title,
  description,
  origin,
  children,
}: {
  name: string;
  title: string;
  description: string;
  origin?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Subgroup
      role="group"
      testId={`inspector-group-${name}`}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-hint`}
    >
      <h4 id={`${id}-name`}>{title}</h4>
      {origin}
      <p id={`${id}-hint`} className="insp-note">
        {description}
      </p>
      {children}
    </Subgroup>
  );
}
