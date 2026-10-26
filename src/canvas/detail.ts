export type DetailView = "overview" | "focus" | "follow" | "custom";
export const TEXT_FLOOR = 10.5;
export const FAR_ZOOM = 0.6;

/** A text run either clears the ink floor or disappears whole. */
export function textDetail(font: number, zoom: number, active: boolean, view: DetailView) {
  if (zoom < FAR_ZOOM) return { show: false, scale: 1 };
  if (font * zoom >= TEXT_FLOOR) return { show: true, scale: 1 };
  const scale = 11 / Math.max(0.01, font * zoom);
  const plain = view === "overview" || view === "custom";
  return { show: plain || (active && scale <= 1.6), scale: plain ? scale : Math.min(1.6, scale) };
}

export function drawTile(height: number, zoom: number, narrated: boolean) {
  return narrated || height * zoom >= 12;
}
