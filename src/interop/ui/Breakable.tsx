import { Fragment } from "react";

/** Break infrastructure names between path parts while preserving their copied text. */
export function Breakable({ text }: { text: string }) {
  return (
    <span>
      {text.split(/(?<=[./])|(?=\[)/).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
