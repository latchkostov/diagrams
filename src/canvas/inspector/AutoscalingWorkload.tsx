import { type ReactNode } from "react";
import type { DiagramFile } from "../../model/types";
import { AutoscalingFields } from "../../planning/lazy";
import type { NodeSimProps } from "../../sim/types";

export function AutoscalingWorkload({
  enabled,
  props,
  set,
  children,
  stencil,
  readDiagram,
  nodeId,
}: {
  readDiagram?: () => DiagramFile;
  nodeId: string;
  stencil: string;
  enabled: boolean;
  props: Record<string, unknown>;
  set: (patch: Partial<NodeSimProps>, key?: string) => void;
  children: ReactNode;
}) {
  return enabled ? (
    <AutoscalingFields readDiagram={readDiagram} nodeId={nodeId} stencil={stencil} props={props} set={set}>
      {children}
    </AutoscalingFields>
  ) : (
    children
  );
}
