import { memo } from "react";
import type { Thumb } from "../lib/thumbnail";

const PAD = 6;

/**
 * A diagram in miniature (see lib/thumbnail.ts): boundaries, edges as straight lines and node
 * cards with their stencil accent. Pure SVG, so it's crisp at any size and costs no rasterising.
 * Decorative: the title next to it names the diagram.
 */
export const DiagramThumbnail = memo(function DiagramThumbnail({ thumb, testId }: { thumb: Thumb; testId?: string }) {
  const w = thumb.w + PAD * 2;
  const h = Math.max(thumb.h, thumb.w * 0.45) + PAD * 2;
  const dy = (h - PAD * 2 - thumb.h) / 2;
  const centre = (i: number) => {
    const n = thumb.nodes[i];
    return n ? [n[0] + n[2] / 2, n[1] + n[3] / 2] : [0, 0];
  };
  // Nodes are drawn at least about 2 viewBox units tall, so a huge diagram still reads as boxes.
  const r = Math.max(0.6, Math.min(3, (thumb.nodes[0]?.[3] ?? 6) * 0.22));
  return (
    <svg
      className="diagram-thumb"
      viewBox={`${-PAD} ${-PAD - dy} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      data-testid={testId}
      data-nodes={thumb.nodes.length}
    >
      {thumb.groups.map(([x, y, gw, gh], i) => (
        <rect key={`g${i}`} className="dt-group" x={x} y={y} width={gw} height={gh} rx={r * 1.6} />
      ))}
      {thumb.edges.map(([a, b], i) => {
        const [x1, y1] = centre(a);
        const [x2, y2] = centre(b);
        return <line key={`e${i}`} className="dt-edge" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      {thumb.nodes.map(([x, y, nw, nh, accent], i) => (
        <g key={`n${i}`}>
          <rect className="dt-node" x={x} y={y} width={nw} height={nh} rx={r} fill={accent} stroke={accent} />
          <rect x={x} y={y} width={Math.min(nh, nw * 0.3)} height={nh} rx={r} fill={accent} />
        </g>
      ))}
    </svg>
  );
});
