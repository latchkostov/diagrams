export type DetailView = "overview" | "focus" | "follow" | "custom";
export const TEXT_FLOOR = 10.5;
export const FAR_ZOOM = 0.6;

/**
 * Secondary text keeps the hide floor. Card titles are never secondary: the `.nb-label` rule in
 * app-shared.css counter-scales them to 9.5 screen pixels in every view.
 */
export function textDetail(font: number, zoom: number, active: boolean, view: DetailView) {
  if (zoom < FAR_ZOOM) return { show: false, scale: 1 };
  if (font * zoom >= TEXT_FLOOR) return { show: true, scale: 1 };
  const scale = 11 / Math.max(0.01, font * zoom);
  const plain = view === "overview" || view === "custom";
  return { show: plain || (active && scale <= 1.6), scale: plain ? scale : Math.min(1.6, scale) };
}

export { frameView } from "./frameView";
