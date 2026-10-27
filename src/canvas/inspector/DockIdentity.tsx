import type { ReactNode } from "react";
import { StencilIcon } from "../../components/StencilIcon";
import { t, useLocale } from "../../i18n";
import { stencilLabel } from "../../i18n/stencils";
import { getStencil } from "../../stencils/registry";

/** The same identity in Edit and Live; the readout supplies its own status control. */
export function DockIdentity({
  node,
  warnings = 0,
  status,
  live = false,
}: {
  node: { label: string; stencil: string };
  warnings?: number;
  status?: ReactNode;
  live?: boolean;
}) {
  useLocale();
  const stencil = getStencil(node.stencil);
  return (
    <div className="dock-identity" data-testid={live ? "dock-live-identity" : "dock-identity"}>
      <span className="dock-identity-tile">
        <StencilIcon stencil={stencil} size={20} />
      </span>
      <span className="dock-identity-name">
        <strong>{node.label}</strong>
        <span> · {stencilLabel(stencil)}</span>
      </span>
      {status ??
        (warnings > 0 && (
          <span className="dock-identity-warning">⚠ {t("workbench.warnings", { count: warnings })}</span>
        ))}
    </div>
  );
}
