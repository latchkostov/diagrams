/** Small UI glyphs (stroke icons, 16px grid). */
const paths: Record<string, string> = {
  search: "M7.25 12.5a5.25 5.25 0 1 0 0-10.5 5.25 5.25 0 0 0 0 10.5ZM14 14l-3-3",
  panel: "M2.5 3.5h11v9h-11zM6 3.5v9",
  sun: "M8 10.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9",
  moon: "M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z",
  upload: "M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3h11v-3",
  download: "M8 2.5v8M5 7.5l3 3 3-3M2.5 10v3h11v-3",
  present: "M2 2.75h12v8.5H2zM8 11.25V14M5.5 14h5",
  close: "M4 4l8 8M12 4l-8 8",
  reset: "M2.75 8a5.25 5.25 0 1 0 1.6-3.8M2.5 2.5v2.75h2.75",
  grid: "M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z",
  canvas: "M3.5 4.5a1.5 1.5 0 1 0 0-.01M12.5 11.5a1.5 1.5 0 1 0 0-.01M5 4.5h3.5a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2",
  fit: "M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3",
};

export function Icon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
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
      <path d={paths[name] ?? ""} />
    </svg>
  );
}
