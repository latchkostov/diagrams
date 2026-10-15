/** The persisted colour contract: a leading hash and 3, 4, 6 or 8 hex digits. */
export const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const isHexColor = (value: unknown): value is string => typeof value === "string" && HEX_COLOR_REGEX.test(value);

/** Picker input may omit the hash. Normalization preserves every channel, including alpha. */
export function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  const color = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return isHexColor(color) ? color.toUpperCase() : null;
}

export const isValidHex = (input: string): boolean => normalizeHex(input) !== null;

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseHexRgba(hex: string): RgbaColor | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const raw = normalized.slice(1);
  let r: number;
  let g: number;
  let b: number;
  let a = 1;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
  } else if (raw.length === 4) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
    a = parseInt(raw[3] + raw[3], 16) / 255;
  } else if (raw.length === 6) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
  } else if (raw.length === 8) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
    a = parseInt(raw.slice(6, 8), 16) / 255;
  } else {
    return null;
  }
  return { r, g, b, a };
}

export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(lum1: number, lum2: number): number {
  return (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
}

/** Returns the hex color if it meets AA contrast (>= 4.5) against the background luminance, or fallback if illegible. */
export function accessibleColor(hex: string, bgLuminance: number, fallback: string): string {
  const rgba = parseHexRgba(hex);
  if (!rgba || rgba.a < 0.5) return fallback;
  const lum = relativeLuminance(rgba.r, rgba.g, rgba.b);
  return contrastRatio(lum, bgLuminance) >= 4.5 ? hex : fallback;
}
