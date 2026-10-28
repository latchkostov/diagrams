import type { CSSProperties, ReactNode } from "react";
import { StencilIcon } from "../../components/StencilIcon";
import type { ChipLayout, SharedChip } from "../lowZoom";
import type { DependencyRelation } from "../../model/relations";
import type { NodeBodyProps } from "./variants";

/** Downloaded with settled detail; the initial canvas retains only the subscription. */
export function ChipNode({ stencil, label, selected, fit }: NodeBodyProps & { fit: ChipLayout }) {
  return (
    <div
      ref={(node) => {
        const icon = node?.firstElementChild;
        icon?.setAttribute("data-testid", "card-icon");
        icon?.classList.add("stencil-icon");
      }}
      className={`nb nb-chip${selected ? " is-selected" : ""}`}
      aria-label={label}
      style={
        {
          left: fit.x,
          top: fit.y,
          width: fit.width,
          height: fit.height,
          "--chip-font": `${fit.font}px`,
          "--chip-icon": `${fit.icon}px`,
        } as CSSProperties
      }
    >
      <StencilIcon stencil={stencil} size={fit.icon} />
      <span className="nb-label" data-testid="card-title" data-label={label}>
        {fit.lines}
      </span>
    </div>
  );
}

export function chipEdge(
  id: string,
  path: string,
  relation: DependencyRelation | null,
  selected: boolean,
  group: string,
  deny: ReactNode,
  shared: SharedChip[] = [],
) {
  return (
    // Keyed: natural cards get fresh elements back, never patched chip ones (an export copies attribute order).
    <g
      key="chip"
      className={`fe fe-chip${relation ? " fe-dep" : ""}${selected ? " is-selected" : ""}`}
      data-testid={`edge-${id}`}
      data-chip-group={group}
      data-relation={relation ?? undefined}
      data-deny={deny ? "true" : undefined}
    >
      <path
        data-testid={`connection-stroke-${id}`}
        d={path}
        className="fe-path react-flow__edge-path"
        vectorEffect="non-scaling-stroke"
      />
      {shared.map(({ path, members }, i) => (
        <path
          key={i}
          d={path}
          className="fe-path"
          vectorEffect="non-scaling-stroke"
          data-chip-members={JSON.stringify(members)}
          data-testid={`chip-shared-${id}-${i}`}
          pointerEvents="none"
        />
      ))}
      {/* The hairline is only ink: the hit stroke is the natural edge's, 22 units wide at every zoom. */}
      <path d={path} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={22} />
      {deny}
    </g>
  );
}
