import { borderRadius } from "../../model/borderRadius";

/** Keep legacy defaults byte-identical; custom radii use draw.io's absolute arc diameter. */
export function radiusStyle(style: string, value: unknown, defaultRadius: number): string {
  const radius = borderRadius(value);
  if (radius === undefined || radius === defaultRadius) return style;
  const base = style.replace(/(?:rounded|arcSize|absoluteArcSize)=[^;]*;/g, "");
  return `rounded=${radius === 0 ? 0 : 1};arcSize=${radius * 2};absoluteArcSize=1;${base}`;
}

/** Our metadata preserves explicit defaults too, without changing foreign-file import defaults. */
export function readRadius(value: string | undefined): { borderRadius?: number } {
  const radius = value?.trim() ? borderRadius(Number(value)) : undefined;
  return radius === undefined ? {} : { borderRadius: radius };
}
