import { FALLBACK_STENCIL, iconUrl } from "../stencils/registry";
import type { Stencil } from "../model/types";

/** Renders a stencil's SVG icon, falling back to the generic box, then to an inline glyph. */
export function StencilIcon({ stencil, size = 24 }: { stencil: Stencil; size?: number }) {
  const src = iconUrl(stencil.icon) ?? iconUrl(FALLBACK_STENCIL.icon);
  if (!src) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        aria-hidden
      >
        <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
        <path d="m3 8 9 5 9-5M12 13v8" />
      </svg>
    );
  }
  return <img src={src} width={size} height={size} alt="" draggable={false} className="stencil-icon" />;
}
