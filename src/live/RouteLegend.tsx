import { useEffect, useRef, useState } from "react";
import type { RequestRoute } from "../model/requestRouting";
import { routeLook } from "../model/routingAppearance";
import { t, useLocale } from "../i18n";

/** The same marker and palette as the particles, so a busy path has a name. */
export function RouteLegend({ routes }: { routes: readonly RequestRoute[] }) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(4);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setLimit(Math.max(1, Math.floor(((el.parentElement?.clientWidth ?? el.clientWidth) - 150) / 120))),
    );
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, []);
  if (!routes.length) return null;
  return (
    <div ref={root} className="live-route-legend" data-testid="live-route-legend">
      <b>{t("camera.requests")}</b>
      {routes.slice(0, open ? routes.length : limit).map((route) => {
        const appearance = routeLook(route);
        const symbol =
          appearance.marker === "square"
            ? "■"
            : appearance.marker === "diamond"
              ? "◆"
              : appearance.marker === "triangle"
                ? "▲"
                : "●";
        return (
          <span key={route.id}>
            <i style={{ color: appearance.color }} aria-hidden>
              {symbol}
            </i>
            {route.label ?? `${route.address.method} ${route.address.path}`}
          </span>
        );
      })}
      {routes.length > limit && (
        <button
          type="button"
          data-testid="live-route-legend-more"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("common.close") : t("camera.more", { count: routes.length - limit })}
        </button>
      )}
    </div>
  );
}
