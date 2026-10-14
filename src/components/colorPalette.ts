/**
 * Color palette data and hex utilities matching the reference grid.
 * 10 columns across the full spectrum: grayscale + 10 hue columns with graduated tints and shades.
 */

export const QUICK_PALETTE: readonly string[] = [
  "#000000",
  "#FFFFFF",
  "#C4B5FD",
  "#93C5FD",
  "#A7F3D0",
  "#FEF08A",
  "#FED7AA",
  "#FECACA",
  "#E2E8F0",
];

export const THEME_PALETTE: readonly (readonly string[])[] = [
  ["#F3E8EE", "#E8D7F1", "#D3B7D8", "#BCA0DC", "#9B72AA", "#E0E7FF", "#C7D2FE", "#93C5FD", "#CCFBF1", "#99F6E4"],
  ["#DCFCE7", "#BBF7D0", "#86EFAC", "#FEF9C3", "#FDE047", "#FACC15", "#FED7AA", "#FB923C", "#FECDD3", "#F87171"],
];

export const SPECTRUM_GRID: readonly (readonly string[])[] = [
  // Row 1: Grayscale ramp
  ["#FFFFFF", "#F3F4F6", "#E5E7EB", "#D1D5DB", "#9CA3AF", "#6B7280", "#4B5563", "#374151", "#1F2937", "#000000"],
  // Row 2: 50 / lightest tint
  ["#FEF2F2", "#FFF7ED", "#FEFCE8", "#F7FEE7", "#F0FDF4", "#ECFEFF", "#EFF6FF", "#EEF2FF", "#FAF5FF", "#FDF2F8"],
  // Row 3: 100 / light tint
  ["#FEE2E2", "#FFEDD5", "#FEF08A", "#ECFCCB", "#DCFCE7", "#CFFAFE", "#DBEAFE", "#E0E7FF", "#F3E8FF", "#FCE7F3"],
  // Row 4: 200
  ["#FECACA", "#FED7AA", "#FDE047", "#D9F99D", "#BBF7D0", "#A5F3FC", "#BFDBFE", "#C7D2FE", "#E9D5FF", "#FBCFE8"],
  // Row 5: 300
  ["#FCA5A5", "#FDBA74", "#FACC15", "#BEF264", "#86EFAC", "#67E8F9", "#93C5FD", "#A5B4FC", "#D8B4FE", "#F472B6"],
  // Row 6: 500 / pure vibrant
  ["#EF4444", "#F97316", "#EAB308", "#84CC16", "#10B981", "#06B6D4", "#3B82F6", "#6366F1", "#A855F7", "#EC4899"],
  // Row 7: 600 / medium shade
  ["#DC2626", "#EA580C", "#CA8A04", "#65A30D", "#059669", "#0891B2", "#2563EB", "#4F46E5", "#9333EA", "#DB2777"],
  // Row 8: 700 / dark shade
  ["#B91C1C", "#C2410C", "#A16207", "#4D7C0F", "#047857", "#0E7490", "#1D4ED8", "#4338CA", "#7E22CE", "#BE185D"],
  // Row 9: 800 / deeper shade
  ["#991B1B", "#9A3412", "#854D0E", "#3F6212", "#065F46", "#155E75", "#1E40AF", "#3730A3", "#6B21A8", "#9D174D"],
  // Row 10: 900 / darkest
  ["#7F1D1D", "#7C2D12", "#713F12", "#365314", "#064E3B", "#164E63", "#1E3A8A", "#312E81", "#581C87", "#831843"],
];

const HEX_REGEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Validate and normalize a hex color to `#RRGGBB` or `#RGB`. */
export function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (!HEX_REGEX.test(trimmed)) return null;
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (hex.length === 3 || hex.length === 6) {
    return `#${hex.toUpperCase()}`;
  }
  if (hex.length === 4) {
    // #RGBA -> #RGB if alpha is FF
    return `#${hex.slice(0, 3).toUpperCase()}`;
  }
  if (hex.length === 8) {
    // #RRGGBBAA -> #RRGGBB if alpha is FF
    return `#${hex.slice(0, 6).toUpperCase()}`;
  }
  return `#${hex.toUpperCase()}`;
}

export function isValidHex(input: string): boolean {
  return HEX_REGEX.test(input.trim());
}
