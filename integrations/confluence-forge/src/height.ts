// The viewer reports fit-to-width height from measured diagram bounds, margins and floating controls.
// Only width and content affect that report; never use the iframe's current height as an input.
export const AUTO_HEIGHT = { min: 480, max: 900 } as const;
export const HEIGHT_PRESETS = { auto: 0, small: 480, medium: 640, large: 800 } as const;

export function macroHeight(fixed: number, fitted: number = AUTO_HEIGHT.min): number {
  return fixed || Math.round(Math.max(AUTO_HEIGHT.min, Math.min(AUTO_HEIGHT.max, fitted)));
}
