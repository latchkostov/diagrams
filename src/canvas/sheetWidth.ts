import { safeStorage } from "../lib/storage";

export const SHEET_WIDTH_KEY = "diagrams.inspector.width.v1";
export const SHEET_NARROW = 1100;

/** available excludes the stencil rail and any separate dock. Reserve room for the drawing. */
export function sheetBounds(viewport: number, available = viewport) {
  if (viewport <= SHEET_NARROW || available < 780) return { min: 296, max: 296 };
  return { min: 300, max: Math.floor(Math.min(viewport * 0.6, available - 480)) };
}

export function sheetWidth(viewport: number, available = viewport, preferred: number | null = null) {
  const { min, max } = sheetBounds(viewport, available);
  const width = preferred ?? Math.max(360, Math.min(viewport * 0.265, 640));
  return Math.round(Math.max(min, Math.min(width, max)));
}

export function readSheetWidth(): number | null {
  const raw = safeStorage.getItem(SHEET_WIDTH_KEY);
  const value = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveSheetWidth(width: number | null) {
  if (width === null) safeStorage.removeItem(SHEET_WIDTH_KEY);
  else safeStorage.setItem(SHEET_WIDTH_KEY, String(width));
}
