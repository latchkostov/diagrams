import { type RequestRoute, type RouteMarker } from "../model/requestRouting";
import { routeLook } from "../model/routingAppearance";

/** A request route's swatch and marker: never colour alone (the marker and the words beside it say it too). */
export function RouteSwatch({ route, size = 12 }: { route: Pick<RequestRoute, "id" | "appearance">; size?: number }) {
  const look = routeLook(route);
  return <MarkerGlyph color={look.color} marker={look.marker} size={size} />;
}

export function MarkerGlyph({ color, marker, size }: { color: string; marker: RouteMarker; size: number }) {
  const c = size / 2;
  const r = size * 0.36;
  const stroke = { fill: color, stroke: "var(--route-outline, #1f2328)", strokeWidth: 1.2 };
  return (
    <svg className="route-swatch" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {marker === "square" ? (
        <rect x={c - r} y={c - r} width={r * 2} height={r * 2} {...stroke} />
      ) : marker === "diamond" ? (
        <path d={`M${c} ${c - r * 1.3}L${c + r * 1.3} ${c}L${c} ${c + r * 1.3}L${c - r * 1.3} ${c}Z`} {...stroke} />
      ) : marker === "triangle" ? (
        <path d={`M${c} ${c - r * 1.25}L${c + r * 1.2} ${c + r}L${c - r * 1.2} ${c + r}Z`} {...stroke} />
      ) : (
        <circle cx={c} cy={c} r={r} {...stroke} />
      )}
    </svg>
  );
}
