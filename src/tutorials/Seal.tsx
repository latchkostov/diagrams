/** Quiet double-ring chapter mark; shape and accessible words both carry its state. */
export function Seal({
  numeral,
  earned,
  label,
  size = 30,
}: {
  numeral: string;
  earned: boolean;
  label: string;
  size?: number;
}) {
  return (
    <svg
      className={`tutorial-seal${earned ? " is-earned" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={label}
    >
      <circle cx="24" cy="24" r="22" fill="none" strokeWidth="1.8" />
      <circle cx="24" cy="24" r="17.5" fill="none" strokeWidth="1" />
      <text x="24" y="24" dy=".36em" textAnchor="middle" fontSize={numeral.length > 2 ? 13 : 16}>
        {numeral}
      </text>
    </svg>
  );
}
