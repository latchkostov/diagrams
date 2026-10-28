import type { CSSProperties } from "react";
import { StencilIcon } from "../../components/StencilIcon";
import type { ChipLayout } from "../lowZoom";
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

export function chipEdge(id: string, path: string, dependency: boolean, selected: boolean, lanes: string[]) {
  return (
    <g
      className={`fe fe-chip${dependency ? " fe-dep" : ""}${selected ? " is-selected" : ""}`}
      data-testid={`edge-${id}`}
      data-chip-lanes={JSON.stringify(lanes)}
    >
      <path
        data-testid={`connection-stroke-${id}`}
        d={path}
        className="fe-path react-flow__edge-path"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
