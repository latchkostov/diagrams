import { TRAFFIC_PATH } from "./glyphPaths";
import { RELATION_GLYPHS } from "./relationGlyphs";

/** Small UI glyphs (stroke icons, 16px grid). */
const paths = {
  lock: "M4 7.25h8v6.5H4zM5.75 7.25V5.25a2.25 2.25 0 0 1 4.5 0v2M8 9.75v1.5",
  search: "M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5ZM14 14l-3-3",
  panel: "M2.5 3.5h11v9h-11zM6 3.5v9",
  "panel-right": "M2.5 3.5h11v9h-11zM10 3.5v9",
  sun: "M8 10.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9",
  moon: "M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z",
  upload: "M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3h11v-3",
  download: "M8 2.5v8M5 7.5l3 3 3-3M2.5 10v3h11v-3",
  present: "M2 2.75h12v8.5H2zM8 11.25V14M5.5 14h5",
  record: "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 10.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z",
  close: "M4 4l8 8M12 4l-8 8",
  reset: "M2.75 8a5.25 5.25 0 1 0 1.6-3.8M2.5 2.5v2.75h2.75",
  grid: "M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z",
  canvas: "M3.5 4.5a1.5 1.5 0 1 0 0-.01M12.5 11.5a1.5 1.5 0 1 0 0-.01M5 4.5h3.5a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2",
  fit: "M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  copy: "M5.5 5.5h7.5v8H5.5zM3 10.5V2.5h7.5",
  cut: "M3 11.75a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 0 0-3.5 0ZM9.5 11.75a1.75 1.75 0 1 0 3.5 0 1.75 1.75 0 0 0-3.5 0ZM5.9 10.4 11.5 2.5M10.1 10.4 4.5 2.5",
  paste: "M5.5 3H3.5v10.5h9V3h-2M6 2h4v2.25H6z",
  trash: "M3 4.5h10M6.5 4.5V2.75h3V4.5M4.5 4.5l.6 9h5.8l.6-9M7 7v4M9 7v4",
  duplicate: "M5.5 5.5h7.5v7.5H5.5zM3 10.5V3h7.5M9.25 7.5v3.5M7.5 9.25H11",
  edit: "M10.5 2.75l2.75 2.75L6 12.75H3.25V10zM9 4.25 11.75 7",
  text: "M3 4h10M3 8h10M3 12h6",
  undo: "M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7",
  redo: "M10.5 3.5l3 3-3 3M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9",
  "align-left": "M2.5 2v12M5 4h7.5v2.75H5zM5 9.25h4.5V12H5z",
  "align-center": "M8 2v12M4.25 4h7.5v2.75h-7.5zM5.75 9.25h4.5V12h-4.5z",
  "align-right": "M13.5 2v12M3.5 4H11v2.75H3.5zM6.5 9.25H11V12H6.5z",
  "align-top": "M2 2.5h12M4 5v7.5h2.75V5zM9.25 5v4.5H12V5z",
  "align-middle": "M2 8h12M4 4.25v7.5h2.75v-7.5zM9.25 5.75v4.5H12v-4.5z",
  "align-bottom": "M2 13.5h12M4 3.5V11h2.75V3.5zM9.25 6.5V11H12V6.5z",
  "distribute-h": "M2.5 2v12M13.5 2v12M6.5 4.5h3v7h-3z",
  "distribute-v": "M2 2.5h12M2 13.5h12M4.5 6.5h7v3h-7z",
  front: "M6 6h7.5v7.5H6zM3.5 10V2.5H10",
  back: "M2.5 2.5H10V10H2.5zM13.5 6v7.5H6",
  swap: "M3 5.5h10M10.5 3 13 5.5 10.5 8M13 10.5H3M5.5 8 3 10.5 5.5 13",
  traffic: TRAFFIC_PATH,
  link: "M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1",
  boundary: "M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11M5.5 5.5h5v5h-5z",
  ungroup: "M2.5 2.5h4.5v4.5H2.5zM9 9h4.5v4.5H9zM9 2.5h4.5V7M2.5 9v4.5H7",
  minimap: "M2.5 3.5h11v9h-11zM8.5 8H12v3H8.5z",
  magnet: "M4 2.5v5a4 4 0 0 0 8 0v-5M4 5h2.5M9.5 5H12M6.5 2.5v5a1.5 1.5 0 0 0 3 0v-5",
  zoom: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM14 14l-3.5-3.5M5 7h4M7 5v4",
  keyboard: "M1.5 4.5h13v7h-13zM4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6",
  sliders: "M3 4.5h10M3 11.5h10M6 3v3M10 10v3",
  hash: "M6.25 2.5 5 13.5M11 2.5 9.75 13.5M2.5 6h11M2 10.5h11",
  "chevron-right": "M6 3.5 10.5 8 6 12.5",
  "chevron-down": "M3.5 6 8 10.5 12.5 6",
  "chevrons-left": "M7.5 4 3.5 8l4 4M12.5 4l-4 4 4 4",
  "chevrons-right": "M3.5 4 7.5 8l-4 4M8.5 4l4 4-4 4",
  check: "M3 8.5 6.5 12 13 4.5",
  tag: "M2.5 2.5h5l6 6-5 5-6-6zM5.5 5.5h.01",
  bolt: "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z",
  inbox: "M2.5 9.5h3l1 2h3l1-2h3M2.5 9.5 4 3.5h8l1.5 6v4h-11z",
  users:
    "M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5a4.5 4.5 0 0 1 9 0M10.5 2.7a2.5 2.5 0 0 1 0 4.6M12 9.3a4.5 4.5 0 0 1 2.5 4.2",
  route: "M3 13.5V7a2.5 2.5 0 0 1 2.5-2.5h6.5M9.5 2 12 4.5 9.5 7",
  trace: "M2.5 13 6 9.5l3 2 1.8-4.3M13.5 4.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  slowmo: "M10.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM1.75 8h3.5M2.75 5.25H5M2.75 10.75H5",
  tone: "M8 2.5a5.5 5.5 0 1 0 0 11c.8 0 1.2-.5 1.2-1.1 0-.9-.7-1-.7-1.9 0-.6.5-1 1.1-1h1.4a2.5 2.5 0 0 0 2.5-2.5C13.5 4.7 11 2.5 8 2.5Z",
  "select-all": "M2.5 5V2.5H5M7 2.5h2M11 2.5h2.5V5M13.5 7v2M13.5 11v2.5H11M9 13.5H7M5 13.5H2.5V11M2.5 9V7",
  layout: "M2.5 3h4v3h-4zM9.5 10h4v3h-4zM9.5 3h4v3h-4zM6.5 4.5h3M11.5 6v4",
  shapes: "M2.5 2.5h5v5h-5zM11 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM5 9.5l2.5 4h-5zM9 9.5h4.5v4H9z",
  sparkle: "M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2",
  // AI: a four-point spark and a small one.
  ai: "M6.5 2.5c.45 2.6 1.4 3.55 4 4-2.6.45-3.55 1.4-4 4-.45-2.6-1.4-3.55-4-4 2.6-.45 3.55-1.4 4-4ZM12 9.5c.2 1.15.6 1.55 1.75 1.75-1.15.2-1.55.6-1.75 1.75-.2-1.15-.6-1.55-1.75-1.75 1.15-.2 1.55-.6 1.75-1.75Z",
  mic: "M8 10.25A2.25 2.25 0 0 0 10.25 8V4.25a2.25 2.25 0 0 0-4.5 0V8A2.25 2.25 0 0 0 8 10.25ZM3.75 7.5a4.25 4.25 0 0 0 8.5 0M8 11.75v2",
  info: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM8 7.5V11M8 5h.01",
  /** A check's warning (amber in the Checks card and its markers). */
  warning: "M8 2.25 14.25 13.25H1.75ZM8 6.5v3M8 11.4h.01",
  /** Check diagram. */
  checklist: "M2.5 4.25l1.25 1.25L6 3.25M2.5 10.25l1.25 1.25L6 9.25M8.5 4.5h5M8.5 10.5h5",
  // Annotations: text, note, zone and the five shapes.
  type: "M3 4V2.75h10V4M8 2.75v10.5M6 13.25h4",
  note: "M2.75 2.75h10.5v6.5l-4 4h-6.5zM13.25 9.25h-4v4M5 5.5h6M5 8h3.5",
  zone: "M2.5 5V4a1.5 1.5 0 0 1 1.5-1.5h1M7 2.5h2M11 2.5h1a1.5 1.5 0 0 1 1.5 1.5v1M13.5 7v2M13.5 11v1a1.5 1.5 0 0 1-1.5 1.5h-1M9 13.5H7M5 13.5H4A1.5 1.5 0 0 1 2.5 12v-1M2.5 9V7M5 5.5h3.5",
  "shape-rect": "M2.5 4h11v8h-11z",
  "shape-rounded": "M5 4h6a2.5 2.5 0 0 1 2.5 2.5v3A2.5 2.5 0 0 1 11 12H5a2.5 2.5 0 0 1-2.5-2.5v-3A2.5 2.5 0 0 1 5 4Z",
  "shape-ellipse": "M8 12.5c3 0 5.5-2 5.5-4.5S11 3.5 8 3.5 2.5 5.5 2.5 8s2.5 4.5 5.5 4.5Z",
  "shape-diamond": "M8 2 14 8 8 14 2 8z",
  "shape-cylinder": "M3 4.5c0-1.1 2.24-2 5-2s5 .9 5 2-2.24 2-5 2-5-.9-5-2ZM3 4.5v7c0 1.1 2.24 2 5 2s5-.9 5-2v-7",
} as const;

/** 16 px glyphs, plus the relationship glyphs drawn on Lucide's 24 px grid. */
export type IconName = keyof typeof paths | keyof typeof RELATION_GLYPHS;

const glyph24: Readonly<Record<string, string>> = RELATION_GLYPHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const big = glyph24[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={big ? "0 0 24 24" : "0 0 16 16"}
      fill="none"
      stroke="currentColor"
      strokeWidth={big ? 2.1 : 1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={big ?? (paths as Readonly<Record<string, string>>)[name] ?? ""} />
    </svg>
  );
}
