import { useLayoutEffect, useRef } from "react";
import { useInteraction } from "../canvas/interaction";
import { t, useLocale } from "../i18n";

/** A logical keyboard stop while the detail body downloads. */
export function DetailsLoading({
  kind,
  id,
  pinned,
  focusClaim,
  failed,
}: {
  kind: "node" | "edge";
  id: string;
  pinned: boolean;
  focusClaim?: () => boolean;
  failed: boolean;
}) {
  useLocale();
  const ref = useRef<HTMLSpanElement>(null);
  const interaction = useInteraction();
  useLayoutEffect(() => {
    if (pinned && ref.current && focusClaim?.()) interaction?.dispatch({ type: "node.details", target: ref.current });
  }, [pinned, focusClaim, interaction]);
  return (
    <span
      ref={ref}
      tabIndex={pinned ? 0 : -1}
      role={pinned ? "region" : "tooltip"}
      data-testid={`live.${kind}-details-loading`}
      data-live-readout={kind}
      data-item={id}
      data-pinned={String(pinned)}
      data-canvas-reading-region=""
      aria-busy={!failed}
      aria-label={failed ? t("ai.loadFailed") : t("common.loading")}
    />
  );
}
