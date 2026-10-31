import { memo } from "react";
import { FALLBACK_STENCIL } from "../stencils/registry";
import { iconUrl } from "../stencils/iconUrls";
import type { Stencil } from "../model/types";

const pendingIcons = new Map<HTMLImageElement, { src: string; observer: IntersectionObserver }>();
let catalogObserver: IntersectionObserver | undefined;

function observeCatalogIcon(image: HTMLImageElement, src: string): (() => void) | undefined {
  if (image.getAttribute("src") === src) return;
  if (typeof IntersectionObserver === "undefined") {
    image.setAttribute("src", src);
    return;
  }
  const observer = (catalogObserver ??= new IntersectionObserver((entries, owner) => {
    for (const entry of entries) {
      const image = entry.target as HTMLImageElement;
      const pending = pendingIcons.get(image);
      if (!entry.isIntersecting || !pending || pending.observer !== owner) continue;
      image.setAttribute("src", pending.src);
      pendingIcons.delete(image);
      owner.unobserve(image);
    }
    if (!pendingIcons.size && catalogObserver === owner) {
      owner.disconnect();
      catalogObserver = undefined;
    }
  }));
  pendingIcons.set(image, { src, observer });
  observer.observe(image);
  return () => {
    if (pendingIcons.get(image)?.observer === observer) pendingIcons.delete(image);
    observer.unobserve(image);
    if (!pendingIcons.size && catalogObserver === observer) {
      observer.disconnect();
      catalogObserver = undefined;
    }
  };
}

/** Renders a stencil's SVG icon, falling back to the generic box, then to an inline glyph. */
export const StencilIcon = memo(function StencilIcon({
  stencil,
  size = 24,
  loading,
}: {
  stencil: Stencil;
  size?: number;
  loading?: "eager" | "lazy";
}) {
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
  return (
    <img
      src={loading === "lazy" ? undefined : src}
      ref={loading === "lazy" ? (image) => (image ? observeCatalogIcon(image, src) : undefined) : undefined}
      width={size}
      height={size}
      alt=""
      draggable={false}
      className="stencil-icon"
    />
  );
});
