import { useCallback, useRef, useState, type RefObject } from "react";
import { safeStorage } from "../../lib/storage";
import { useCovered, useOverlayTestIds } from "../useOverlayFit";
import { useBelow } from "../checks/useBelow";
import { Icon } from "../../components/Icon";
import { MarkdownView } from "../../components/markdown/lazy";
import { UNTITLED } from "../../lib/diagramIO";
import { PRIVACY_REQUEST } from "../../lib/usePrivacy";
import { t as tr } from "../../i18n";
import type { DiagramMeta } from "../convert";
import { DiagramCardMeta, type ChecksHost } from "../checks/ChecksViews";
import type { ChecksStore } from "../checks/useChecks";
import { PresentFullscreen } from "../PresentFullscreen";
import { StartCard, type StartOptions } from "../StartCard";
import { FirstRunHint } from "../FirstRunHint";

const HINT_KEY = "diagrams.firstRunHint.v1";

export function useChromeHint(readOnly: boolean) {
  const [startDismissed, setStartDismissed] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => readOnly || safeStorage.getItem(HINT_KEY) === "1");
  const dismissHint = useCallback(() => {
    setHintSeen(true);
    safeStorage.setItem(HINT_KEY, "1");
  }, []);
  return { startDismissed, setStartDismissed, hintSeen, dismissHint };
}

/** Keep overlay measurement hooks in CanvasView's original hook order. */
export function useChromeOverlays(wrapper: RefObject<HTMLDivElement | null>, checksVisible: boolean) {
  // The title card folds to a chip while nodes sit under it, so it never hides the diagram.
  const card = useRef<HTMLDivElement>(null);
  const cardCovers = useCovered(card, wrapper);
  const checksTop = useBelow(card, checksVisible);
  useOverlayTestIds(wrapper);

  return { card, cardCovers, checksTop };
}

export function CanvasOverlays({
  bezel,
  card,
  cardCovers,
  presenting,
  privacy,
  hideChrome,
  nodeCount,
  meta,
  checks,
  checksCard,
  openingFitDone,
  modified,
  ownDiagram,
  reset,
  onExitPresent,
  contentCount,
  live,
  start,
  startDismissed,
  onBlank,
  paletteHidden,
  hintSeen,
  dismissHint,
}: {
  bezel?: boolean;
  card: RefObject<HTMLDivElement | null>;
  cardCovers: boolean;
  presenting: boolean;
  privacy: "private" | "local-only" | null;
  hideChrome: boolean;
  nodeCount: number;
  meta: DiagramMeta;
  checks: ChecksStore;
  checksCard: boolean;
  openingFitDone: boolean;
  modified: boolean;
  ownDiagram: boolean;
  reset: () => void;
  checksOn: boolean;
  checksHost: ChecksHost;
  checksTop: number;
  checksMounted: () => void;
  onExitPresent: () => void;
  contentCount: number;
  live: boolean;
  start?: StartOptions;
  startDismissed: boolean;
  onBlank: () => void;
  paletteHidden: boolean;
  hintSeen: boolean;
  dismissHint: () => void;
}) {
  return (
    <>
      <div
        ref={card}
        className={`diagram-card${presenting ? " is-large" : ""}${cardCovers ? " is-compact" : ""}${privacy && !hideChrome ? " has-badge" : ""}`}
        data-testid="diagram-card"
        data-canvas-overlay
        data-collapsed={cardCovers ? "1" : undefined}
        // A blank, untitled diagram is already named in the picker: the card waits for the first node
        // (a private one shows at once, so its lock does).
        hidden={
          nodeCount === 0 &&
          !presenting &&
          (meta.title || UNTITLED) === UNTITLED &&
          !meta.description &&
          !(privacy && !hideChrome)
        }
      >
        {/* The person's own words: their direction is their own, whatever the language around them (dir="auto"). */}
        <h1 data-testid={bezel ? "diagram-card-title" : "diagram-title"} dir="auto">
          {meta.title}
        </h1>
        {privacy && !hideChrome && <PrivateBadge kind={privacy} />}
        {meta.description && (
          <div dir="auto" className="diagram-description" data-testid="diagram-description">
            <MarkdownView text={meta.description} />
          </div>
        )}
        {/* Node and edge counts live in the inspector's diagram panel, not here too. */}
        {!hideChrome && (
          <DiagramCardMeta
            store={checks}
            open={checksCard}
            showWarnings={openingFitDone}
            reset={
              modified &&
              !ownDiagram && (
                <button
                  className="link-btn"
                  onClick={reset}
                  data-testid="reset-diagram"
                  title={tr("canvas.discardYourEditsToThisDiagramUndoable")}
                >
                  <Icon name="reset" size={13} />
                  {tr("canvas.editedReset")}
                </button>
              )
            }
          />
        )}
      </div>

      {presenting && (
        <div className="present-bar">
          <PresentFullscreen />
          <button className="present-exit" onClick={onExitPresent} data-testid="present-exit">
            <Icon name="close" size={14} /> {tr("present.exit")} <kbd>{tr("keys.escape")}</kbd>
          </button>
        </div>
      )}

      {contentCount === 0 && !hideChrome && !live && start && !startDismissed ? (
        <StartCard start={start} onBlank={onBlank} />
      ) : (
        contentCount === 0 &&
        !hideChrome && (
          <div className="canvas-empty" data-testid="canvas-empty">
            <strong>{tr("canvas.thisDiagramIsEmpty")}</strong>
            <span>
              {paletteHidden
                ? tr("chrome.doubleClickTheCanvasToAddANodeOrOpen")
                : tr("chrome.dragAStencilFromTheLeftOrDoubleClickThe")}
            </span>
          </div>
        )
      )}

      {nodeCount > 0 && !hideChrome && !live && !hintSeen && (
        <FirstRunHint simulations={meta.simulations?.length ?? 0} onDismiss={dismissHint} />
      )}
    </>
  );
}

/**
 * The lock beside the title of a private diagram. A click explains what Private means and offers to turn it
 * off (one confirmation). A local-only example's lock only says it's always private.
 */
function PrivateBadge({ kind }: { kind: "local-only" | "private" }) {
  const always = kind === "local-only";
  return (
    <button
      type="button"
      className="private-badge"
      data-testid="private-badge"
      data-kind={kind}
      aria-label={
        always ? tr("chrome.privateAlwaysItComesFromALocalOnlyExample") : tr("chrome.privateDiagramWhatThisMeans")
      }
      title={
        always ? tr("chrome.alwaysPrivateNoShareLinksCloudSavesOrAI") : tr("chrome.privateNoShareLinksCloudSavesOrAI")
      }
      aria-disabled={always || undefined}
      onClick={() => {
        if (!always) window.dispatchEvent(new Event(PRIVACY_REQUEST));
      }}
    >
      <Icon name="lock" size={12} /> {tr("ai.private")}
    </button>
  );
}
