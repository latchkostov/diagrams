// Saturated mid-tones stay distinct against both canvas themes.
export const MESSAGE_PALETTE = [
  "#e85d75",
  "#8b6cef",
  "#309bd5",
  "#20b69b",
  "#e09a26",
  "#d65cbe",
  "#497fe8",
  "#80ac32",
  "#e97839",
  "#a777ca",
  "#18a6b5",
  "#ca6578",
] as const;

export function messageColor(type: string): string {
  let hash = 2166136261;
  for (let i = 0; i < type.length; i++) {
    hash = Math.imul(hash ^ type.charCodeAt(i), 16777619);
  }
  return MESSAGE_PALETTE[(hash >>> 0) % MESSAGE_PALETTE.length];
}
