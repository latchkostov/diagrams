// Glyphs for import / export UI (16px grid, stroke icons matching components/Icon.tsx), plus a few
// small format marks (draw.io, Mermaid, Google Drive) so menu rows are recognisable at a glance.

const strokes = {
  file: "M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5",
  json: "M4 1.75h5.25L12.5 5v9.25H4zM9 1.75V5.25h3.5M7 8.25c-.75 0-1 .4-1 1v.25c0 .5-.25.75-.75.75.5 0 .75.25.75.75v.25c0 .6.25 1 1 1M9.5 8.25c.75 0 1 .4 1 1v.25c0 .5.25.75.75.75-.5 0-.75.25-.75.75v.25c0 .6-.25 1-1 1",
  image: "M2.25 3h11.5v10H2.25zM2.25 11l3.5-3.5 3 3 2-2 3 3M10.5 6.25h.01",
  vector: "M3 13 8 2.75 13 13M5 9h6M2 13h2M12 13h2M7.25 2h1.5v1.5h-1.5z",
  users:
    "M6 7.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zM1.75 13.75c0-2.35 1.9-4.25 4.25-4.25s4.25 1.9 4.25 4.25M10.75 7a1.9 1.9 0 0 0 0-3.8M11.5 9.6c1.65.35 2.75 1.95 2.75 3.9",
  link: "M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1",
  code: "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13",
  share: "M8 10V2M5 4.75l3-3 3 3M3.5 7.5v6h9v-6",
  device: "M2.5 3h11v7.5h-11zM1 13h14M6.5 10.5v2.5M9.5 10.5v2.5",
  save: "M2.75 2.75h8.5l2 2v8.5H2.75zM5 2.75v3.5h5v-3.5M4.75 13.25v-4h6.5v4",
  folder: "M1.75 4.25v8.5h12.5V5.75H8L6.5 3.75H1.75zM1.75 7.25h12.5",
  cloud: "M4.6 12.75h6.9a2.75 2.75 0 0 0 .35-5.48 3.9 3.9 0 0 0-7.45-.97 3.25 3.25 0 0 0 .2 6.45Z",
  clipboard: "M5.5 3H3.5v10.5h9V3h-2M6 2h4v2.25H6zM5.5 8h5M5.5 10.5h3",
  info: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM8 7.5V11M8 5h.01",
  "check-circle": "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM5.5 8.25l1.75 1.75L10.75 6.5",
  alert: "M8 1.75 14.5 13.5h-13zM8 6.25V9.5M8 11.5h.01",
  close: "M4 4l8 8M12 4l-8 8",
  "chevron-down": "M4 6.25 8 10.25l4-4",
  "chevron-right": "M6 3.5 10.5 8 6 12.5",
  upload: "M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3h11v-3",
  download: "M8 2.5v8M5 7.5l3 3 3-3M2.5 10v3h11v-3",
  external: "M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4",
  copy: "M5.5 5.5h7.5v8H5.5zM3 10.5V2.5h7.5",
  play: "M5 3.5v9l7-4.5z",
  check: "M3 8.5 6.5 12 13 4.5",
  sliders: "M3 4.5h10M3 11.5h10M6 3v3M10 10v3",
  lock: "M4 7.25h8v6.5H4zM5.75 7.25V5.25a2.25 2.25 0 0 1 4.5 0v2M8 9.75v1.5",
  eye: "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  /** Your diagrams: a small stack of documents. */
  stack: "M5.25 4.25h7v9.5h-7zM3.75 11.75V2.25h6.5M7.25 7.25h3M7.25 9.75h3",
} as const;

export type GlyphName = keyof typeof strokes | "spinner" | "drive" | "onedrive" | "dropbox" | "drawio" | "mermaid";

export function Glyph({ name, size = 16 }: { name: GlyphName; size?: number }) {
  if (name === "spinner") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className="ix-spin">
        <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.6" />
        <path d="M13.75 8A5.75 5.75 0 0 0 8 2.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
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
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={strokes[name]} />
    </svg>
  );
}
