import type { CSSProperties } from "react";
import { Icon } from "../../components/Icon";
import { StencilIcon } from "../../components/StencilIcon";
import type { Stencil } from "../../model/types";
import { getStencil } from "../../stencils/registry";
import type { AiError, DiagramOp } from "../index";
import { failedRef, type StencilChoice } from "./apply";
import type { ParsedReply } from "./reply";

// Pieces the AI panel's thread and its Advanced copy-and-paste flow share.

export interface Failure {
  error: AiError;
  /** The reply that failed, as pasted (for the fix-up prompt). */
  reply: string;
  /** The ops that failed, when the reply had ops (a candidate click patches them). */
  ops?: DiagramOp[];
  layout?: Extract<ParsedReply, { kind: "ops" }>["layout"];
  /** The reply was a simulation (the fix-up prompt asks for one again). */
  simulation?: boolean;
}

/** A stencil icon on its light tile, as on the canvas (brand marks are dark ink). */
export function Tile({ stencil, size }: { stencil: Stencil; size: number }) {
  return (
    <span className="ai-tile" style={{ "--tile-accent": stencil.accent } as CSSProperties}>
      <StencilIcon stencil={stencil} size={size} />
    </span>
  );
}

/** A stencil the app wasn't sure of, with its alternatives one click away (shown while its node is current). */
export function ChoiceRow({ choice, onSwap }: { choice: StencilChoice; onSwap: (stencilId: string) => void }) {
  const s = getStencil(choice.stencil.id);
  const sure = choice.stencil.confidence === "high";
  return (
    <div className="ai-choice" data-testid={`ai-choice-${choice.nodeId}`}>
      <span className="ai-choice-pick">
        <Tile stencil={s} size={16} />
        <span>
          <strong>{s.label}</strong>
          {!sure && (
            <>
              {" "}
              for “{choice.kind}”{" "}
              <span className={`ai-confidence is-${choice.stencil.confidence}`}>
                {choice.stencil.confidence === "low" ? "a guess" : "not sure"}
              </span>
            </>
          )}
        </span>
      </span>
      {choice.stencil.alternatives.length > 0 && (
        <span className="ai-choice-alts" role="group" aria-label={`Other stencils for ${choice.kind}`}>
          {choice.stencil.alternatives.slice(0, 3).map((id) => {
            const alt = getStencil(id);
            return (
              <button
                key={id}
                className="ai-alt"
                onClick={() => onSwap(id)}
                title={`Use ${alt.label} (${alt.vendor})`}
                aria-label={`Use ${alt.label}`}
                data-testid={`ai-swap-${choice.nodeId}-${id}`}
                data-node={choice.nodeId}
                data-stencil={id}
              >
                <Tile stencil={alt} size={13} />
                {alt.label}
              </button>
            );
          })}
        </span>
      )}
    </div>
  );
}

export function FailureBox({
  failure,
  copied,
  onCopyFix,
  onChoose,
  fixOff = false,
}: {
  failure: Failure;
  copied: boolean;
  onCopyFix: () => void;
  /** A private diagram: no fix-up prompt is copied (the button stays, off, saying why). */
  fixOff?: boolean;
  onChoose: (id: string) => void;
}) {
  const { error } = failure;
  const canPick = !!failure.ops && !!(error.ref ?? failedRef(error.error));
  const candidates = error.candidates?.slice(0, 8) ?? [];
  return (
    <section className="ai-failure" role="alert" data-testid="ai-error">
      <p className="ai-failure-title">
        <Icon name="info" size={14} />
        <span>
          Nothing was applied.{" "}
          {error.i >= 0 && failure.ops ? (
            <>
              Op {error.i + 1} of {failure.ops.length}:{" "}
            </>
          ) : null}
          <span data-testid="ai-error-message">{error.error}</span>
        </span>
      </p>
      {candidates.length > 0 && (
        <div className="ai-candidates">
          <p className="ai-candidates-label">
            {canPick ? "Did you mean one of these? Pick one to apply." : "Elements it could mean:"}
          </p>
          <ul data-testid="ai-candidates">
            {candidates.map((c) => {
              const s = c.stencil ? getStencil(c.stencil) : undefined;
              const body = (
                <>
                  {s && <Tile stencil={s} size={14} />}
                  <span className="ai-candidate-label">{c.label || c.id}</span>
                  <code>{c.id}</code>
                </>
              );
              return (
                <li key={c.id}>
                  {canPick ? (
                    <button
                      className="ai-candidate"
                      onClick={() => onChoose(c.id)}
                      data-testid={`ai-candidate-${c.id}`}
                    >
                      {body}
                    </button>
                  ) : (
                    <span className="ai-candidate" data-testid={`ai-candidate-${c.id}`}>
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error.hint && !canPick && <p className="ai-failure-hint">{error.hint}</p>}
      <div className="ai-copy-row">
        <button className="btn btn-primary" onClick={onCopyFix} disabled={fixOff} data-testid="ai-copy-fix">
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy fix-up prompt"}
        </button>
        <span className="ai-hint">
          {fixOff ? "Off for this private diagram." : "Your AI corrects its reply; paste it back below."}
        </span>
      </div>
    </section>
  );
}

/**
 * "Try the on-device model": the remembered on/off for Chrome's built-in model's request box. In Advanced, or on
 * its own in a copy deployed without AI tools (which has no Advanced), so it can always be turned back on.
 */
export function OnDevicePreference({ on, set }: { on: boolean; set: (on: boolean) => void }) {
  return (
    <label className="ai-ondevice-pref" data-testid="ai-ondevice-pref">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} data-testid="ai-ondevice-toggle" />
      <span>
        Try the on-device model
        <small>Chrome&apos;s built-in model, on this device: a request box at the panel&apos;s foot.</small>
      </span>
    </label>
  );
}
