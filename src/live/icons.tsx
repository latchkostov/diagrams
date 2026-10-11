// Glyphs for the live view (16px grid, 1.5 stroke) in the same style as components/Icon.tsx.

import { TRAFFIC_PATH } from "../components/glyphPaths";

const paths = {
  play: "M5 3.2v9.6a.5.5 0 0 0 .76.43l7.6-4.8a.5.5 0 0 0 0-.86l-7.6-4.8A.5.5 0 0 0 5 3.2Z",
  pause: "M5 3h2v10H5zM9 3h2v10H9z",
  restart: "M2.75 8a5.25 5.25 0 1 0 1.6-3.8M2.5 2.5v2.75h2.75",
  step: "M3.5 3.5 9 8l-5.5 4.5zM11.5 3.5v9",
  traffic: TRAFFIC_PATH,
  events: "M2.5 4h11M2.5 8h11M2.5 12h7",
  edit: "M10.5 2.75l2.75 2.75L6 12.75H3.25V10zM9 4.25 11.75 7",
  close: "M4 4l8 8M12 4l-8 8",
  check: "M3 8.5 6.5 12 13 4.5",
  x: "M5 5l6 6M11 5l-6 6",
  dot: "M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
  bolt: "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z",
  live: "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5.2 10.8a4 4 0 0 1 0-5.6M10.8 5.2a4 4 0 0 1 0 5.6M3.4 12.6a6.5 6.5 0 0 1 0-9.2M12.6 3.4a6.5 6.5 0 0 1 0 9.2",
  note: "M3 2.5h10v8H7.5L4.5 13v-2.5H3z",
  plus: "M8 3v10M3 8h10",
  trash: "M3 4.5h10M6.5 4.5V2.75h3V4.5M4.5 4.5l.6 9h5.8l.6-9",
  target:
    "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 1v2M8 13v2M1 8h2M13 8h2",
  flag: "M3.5 14V2.5M3.5 3h8l-1.75 3 1.75 3h-8",
  storm: "M4.5 10.5a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.8 5a2.75 2.75 0 0 1 .2 5.5M7.5 9 6 12h2.5L7 15",
  warn: "M8 2.5 14 13H2zM8 6.5v3M8 11.3h.01",
  save: "M3 2.5h8l2 2v9H3zM5.5 2.5v3.5h4.5V2.5M5 13.5V9.5h6v4",
  chevron: "M3.5 6 8 10.5 12.5 6",
  gauge: "M2.25 11.5a5.75 5.75 0 1 1 11.5 0M8 11.5l2.6-3.4M8 11.5h.01M4.4 7.6l.9.6M8 5.75v1M11.6 7.6l-.9.6",
  minus: "M3.5 8h9",
  record: "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 10.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z",
  stop: "M4.75 4.75h6.5v6.5h-6.5z",
  trace: "M2.5 13 6 9.5l3 2 1.8-4.3M13.5 4.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  /** A dot with short motion lines: slow motion. */
  slowmo: "M10.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM1.75 8h3.5M2.75 5.25H5M2.75 10.75H5",
  sequence: "M4 2.5v11M12 2.5v11M4 5.5h7M11 5.5 9.5 4M11 5.5 9.5 7M12 10.5H5M5 10.5 6.5 9M5 10.5 6.5 12",
  more: "M2.5 8a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 1 0-2.5 0ZM6.75 8a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 1 0-2.5 0ZM11 8a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 1 0-2.5 0Z",
} as const;

export type LiveIconName = keyof typeof paths;

export function LiveIcon({ name, size = 16, className }: { name: LiveIconName; size?: number; className?: string }) {
  const filled = name === "play" || name === "pause" || name === "more";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d={paths[name]} />
    </svg>
  );
}
