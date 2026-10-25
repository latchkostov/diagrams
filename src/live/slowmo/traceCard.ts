import { useMemo } from "react";
import { t, useLocale } from "../../i18n";
import { formatDuration as formatSpan } from "../../trace/journey";
import { PACING } from "./pacing";
import type { SlowMotionView } from "./controller";

export function useSlowTraceCard(slow: SlowMotionView) {
  useLocale();
  const slowState = slow.state;
  const script = slowState.script;
  const note = script
    ? [
        script.unfinished
          ? t("liveSession.recordedFor", {
              duration: t("liveSession.lookAhead"),
              summary: script.summary.toLowerCase(),
            })
          : "",
        script.duration > PACING.longScript
          ? t("liveSession.longReplay", { duration: formatSpan(script.duration) })
          : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined
    : undefined;
  const slowCard = useMemo(() => {
    if (slowState.status !== "on" || !script || !slowState.trace) return null;
    return {
      trace: { rootId: slowState.trace.rootId, current: slowState.trace },
      card: {
        playing: slowState.playing,
        row: slowState.row,
        activeRows: slowState.activeRows,
        onToggle: () => slow.session.toggle(),
        onSeek: (key: string) => slow.session.seekRow(key),
        onExit: slow.end,
        hiddenCopies: script.hiddenCopies,
        note,
      },
    };
  }, [slowState, script, slow.session, slow.end, note]);
  return slowCard;
}
