/** Provider and format artwork is only needed when a file menu or dialog shows it. */
export function BrandGlyph({
  name,
  size = 16,
}: {
  name: "drive" | "onedrive" | "dropbox" | "drawio" | "mermaid";
  size?: number;
}) {
  if (name === "drive") {
    // Google Drive's three-colour triangle.
    return (
      <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden>
        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
        <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9.06 9.06 0 0 0 0 53h27.5z" fill="#00ac47" />
        <path
          d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z"
          fill="#ea4335"
        />
        <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
        <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
        <path
          d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z"
          fill="#ffba00"
        />
      </svg>
    );
  }
  if (name === "onedrive") {
    // A simple blue cloud: recognisable at 16px without copying Microsoft's artwork.
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <path
          d="M4.4 12.75h7.85a2.9 2.9 0 0 0 .35-5.78 4.1 4.1 0 0 0-7.73-1.06A3.45 3.45 0 0 0 4.4 12.75Z"
          fill="#0f6cbd"
        />
        <path d="M6.6 12.75h5.65a2.9 2.9 0 0 0 .35-5.78A3.6 3.6 0 0 0 6.6 12.75Z" fill="#28a8ea" />
      </svg>
    );
  }
  if (name === "dropbox") {
    // Dropbox's open box of four diamonds, simplified.
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="#0061fe">
        <path d="M4.5 1.75 1 4l3.5 2.25L8 4zM11.5 1.75 8 4l3.5 2.25L15 4zM1 8.5l3.5 2.25L8 8.5 4.5 6.25zM11.5 6.25 8 8.5l3.5 2.25L15 8.5zM4.5 11.5 8 13.75l3.5-2.25L8 9.25z" />
      </svg>
    );
  }
  if (name === "drawio") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="#F08705" />
        <path d="M8 4.25v3M8 7.25 4.75 10M8 7.25 11.25 10" stroke="#fff" strokeWidth="1.2" fill="none" />
        <rect x="6.25" y="2.75" width="3.5" height="2.5" rx=".6" fill="#fff" />
        <rect x="3" y="9.75" width="3.5" height="2.5" rx=".6" fill="#fff" />
        <rect x="9.5" y="9.75" width="3.5" height="2.5" rx=".6" fill="#fff" />
      </svg>
    );
  }
  if (name === "mermaid") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="#FF3670" />
        <path
          d="M3.5 4.5c1.9 0 3.1 1 3.6 3.1L8 11.5l.9-3.9c.5-2.1 1.7-3.1 3.6-3.1"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }
  return null;
}
