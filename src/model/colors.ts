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
