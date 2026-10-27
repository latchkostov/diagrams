import { Icon } from "../../components/Icon";
import { PRIVACY_REQUEST } from "../../lib/usePrivacy";
import { t as tr } from "../../i18n";

/**
 * The lock beside the title of a private diagram. A click explains what Private means and offers to turn it
 * off (one confirmation). A local-only example's lock only says it's always private.
 */
export function PrivateBadge({ kind }: { kind: "local-only" | "private" }) {
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
