/** Isolate a complete rate, ratio, duration or identifier inside translated prose. */
export const isolate = (value: string | number): string => `\u2068${value}\u2069`;
