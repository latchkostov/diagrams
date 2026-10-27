export type DetailView = "overview" | "focus" | "follow" | "custom";
export const TEXT_FLOOR = 10.5;
export const FAR_ZOOM = 0.6;
export const TITLE_FLOOR = 9.5;

/** Titles always counter-scale; secondary text keeps the existing hide floor. */
export function textDetail(font: number, zoom: number, active: boolean, view: DetailView, title = false) {
  if (title) return { show: true, scale: Math.max(1, TITLE_FLOOR / (font * zoom)) };
  if (zoom < FAR_ZOOM) return { show: false, scale: 1 };
  if (font * zoom >= TEXT_FLOOR) return { show: true, scale: 1 };
  const scale = 11 / Math.max(0.01, font * zoom);
  const plain = view === "overview" || view === "custom";
  return { show: plain || (active && scale <= 1.6), scale: plain ? scale : Math.min(1.6, scale) };
}

/** A selected subset panned into view is Focus even when the preceding whole fit was Overview. */
export function frameView(view: DetailView, selected: number, outside: boolean): DetailView {
  return view === "overview" && selected === 1 && outside ? "focus" : view;
}
