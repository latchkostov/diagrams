import { EdgePriorityField } from "./PriorityField";
import { defineLazySurface } from "../../lib/lazySurface";
import "../../styles/inspector-layout.css";
import { isFanOut, relationDropdownItems } from "./edgeChoices";
import { Dropdown } from "../../components/Dropdown";
import { Icon } from "../../components/Icon";
import { RELATION_CHOICES, applyChoice, choiceOf, relationIcon } from "../../editor/relationActions";
import { t } from "../../i18n";
import { brokerSpec } from "../../model/brokers";
import { relationNote, relationOf, isDependency } from "../../model/relations";
import { EdgeLiveDetails } from "../../planning/EdgeLiveDetails";
import { EdgeRouteFields } from "../../planning/lazy";
import { groupLabel } from "../../stencils/brokerVocabulary";
import { isDenyRule, isFirewallStencil } from "../../stencils/netDevices";
import { getStencil } from "../../stencils/registry";
import { edgeSimFields } from "../simFieldRules";
import { type DiagramFlowEdge } from "../types";
import { Field, InertNote, Section, Segmented } from "./fields";
import { Disclosure } from "./Disclosure";
import { SettingsEditor } from "./SettingsEditor";
import { SimInput } from "./SimulationFields";
import { type InspectorProps } from "./types";
import { useNameFields } from "./useNameFields";
import { useEffect, useLayoutEffect, useState } from "react";
import { useInteraction } from "../interaction/useInteraction";
import { type EditorApi } from "../../editor/types";
import { relationLabel } from "../../i18n/chrome";
import { inferRelation } from "../../stencils/relations";
import { revisionAtLeast } from "../../model/revisions";
import { routingEnabled } from "../../model/requestRouting";
import { MessageFields } from "./lazyMessageFields";
import { callPolicy } from "../../sim/callPolicy";
import type { EdgeSimProps } from "../../sim/types";
import { useCallerOverride } from "./useCallerOverride";

const EdgeAdvanced = defineLazySurface({
  id: "inspector.advanced",
  load: () => import("./EdgeAdvanced").then((m) => m.EdgeAdvanced),
  placeholder: { size: {}, testId: "inspector.advanced-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});
/**
 * A Request's wait, timeout, pool and retry fields: their own chunk, asked for as its inspector opens. While they
 * download, a polite status says so (as slow motion's does); a failed download offers Retry in a toast.
 */
const CallWaitFields = defineLazySurface({
  id: "inspector.call",
  load: () => import("./CallWaitFields").then((m) => m.CallWaitFields),
  placeholder: {
    size: {},
    testId: "inspector.call-loading",
    render: (_, { failed }) =>
      failed ? null : (
        <p className="insp-note" role="status" aria-live="polite" data-testid="call-fields-loading">
          {t("common.loading")}
        </p>
      ),
  },
  focus: { restoreTo: "inspector-section-edge-simulation" },
  export: "skip",
  retryToast: true,
});

export function EdgePanel({ edge, editor, nodeLabel, meta, readDiagram }: InspectorProps & { edge: DiagramFlowEdge }) {
  const interaction = useInteraction();
  const override = useCallerOverride(edge.id);

  // A deferred panel commits after the Inspector frame: retry the name field parked on its download.
  useLayoutEffect(() => interaction?.rendered());
  const naming = useNameFields(editor, "edge", edge.id, edge.id);
  const data = edge.data ?? { kind: "async" as const };
  const props = data.props ?? {};
  const merge = (f: string) => ({ merge: `inspector:edge:${edge.id}:${f}` });
  const relation = relationOf(data);
  const flow = relation === "flow";
  const fanOut = flow && isFanOut(editor, edge.source, data.kind);
  const choice = choiceOf(data);
  // A connection leaving a firewall is one of its rules: allow (the default) or deny.
  const rule = flow && isFirewallStencil(editor.getNode(edge.source)?.stencil);
  // Consumer groups exist only on edges out of a topic or stream; a dead-letter route only out of a broker.
  const source = editor.getNode(edge.source);
  const sourceStencil = source?.stencil;
  const sourceRole = sourceStencil ? getStencil(sourceStencil).simRole : undefined;
  const fields = edgeSimFields(sourceRole);
  const grouped = flow && fields.group && props.dlq !== true;
  const deadLetters = flow && fields.dlq;
  const requestWait = flow && data.kind === "sync" && revisionAtLeast(meta.planning?.revision, "p3-w1");
  const caller = { ...(props.caller as EdgeSimProps["caller"]), ...override };
  const policy = callPolicy(sourceStencil ?? "", caller);
  const callSummary = requestWait
    ? t("workspaceInspector.requestSummary", {
        wait: policy.blocking ? t("threads.holds") : t("threads.frees"),
        timeout:
          policy.deadlineMs === undefined
            ? t("threads.noTimeout")
            : t("workspaceInspector.timeoutSummary", { duration: policy.deadlineMs }),
        retry:
          caller.retry && caller.retry.maxAttempts > 1
            ? t("resilience.attempts", { count: caller.retry.maxAttempts })
            : t("resilience.off"),
      })
    : t("workspaceInspector.valueSummary", {
        label: t("inspector.shareOfMessages"),
        value: `${typeof props.share === "number" ? Math.round(props.share * 1000) / 10 : 100}%`,
      });
  // On intent: by the time the Simulation section opens, its fields are usually here.
  useEffect(() => {
    if (requestWait) CallWaitFields.preload();
  }, [requestWait]);
  const routeCaller =
    data.kind === "sync" && (sourceRole === "source" || sourceRole === "processor" || sourceRole === "none");
  return (
    <>
      <Section>
        <div className="insp-route">
          <span>{nodeLabel(edge.source)}</span>
          <Icon name="chevron-right" size={12} />
          <span>{nodeLabel(edge.target)}</span>
          <button
            className="icon-btn insp-mini"
            onClick={() => editor.reverseEdge(edge.id)}
            title={t("inspector.reverseDirection")}
            aria-label={t("inspector.reverseDirection")}
            data-testid="inspector-reverse"
          >
            <Icon name="swap" size={14} />
          </button>
        </div>
        <Field label={t("inspector.label")}>
          <input
            className="insp-input"
            value={data.label ?? ""}
            placeholder={flow ? t("inspector.eGOrderplaced") : t("inspector.optionalEGKeyVaultSecretsUser")}
            onChange={(e) => editor.updateEdge(edge.id, { label: e.target.value }, naming.merge())}
            {...naming.keys}
            name="edge-label"
            data-testid="inspector-field-label"
          />
        </Field>
        <Field
          label={t("inspector.relationship")}
          hint={t("inspector.flowsCarryMessagesInLiveDependenciesAreDrawnDotted")}
        >
          <Dropdown
            value={choice}
            onChange={(nextId) => {
              const next = RELATION_CHOICES.find((c) => c.id === nextId);
              if (next) applyChoice(editor, [edge.id], next);
            }}
            items={relationDropdownItems()}
            name="relationship"
            aria-label={t("inspector.relationship")}
            testId="inspector-field-relation"
          />
        </Field>
        <RelationHint edge={edge} editor={editor} />
        {rule && (
          <Field
            label={t("inspector.firewallRule")}
            hint={t("inspector.denyBlocksWhatTheFirewallWouldSendHereBlocked")}
            group
          >
            <Segmented
              value={isDenyRule(props) ? "deny" : "allow"}
              options={[
                { value: "allow", label: t("inspector.allow"), hint: t("inspector.trafficPasses") },
                { value: "deny", label: t("inspector.deny"), hint: t("inspector.trafficIsBlockedAtTheFirewall") },
              ]}
              onChange={(v) => editor.setEdgeProps(edge.id, { deny: v === "deny" || undefined })}
              testId="inspector-field-rule"
              label={t("inspector.firewallRule")}
            />
          </Field>
        )}
        {grouped && (
          <Field
            label={groupLabel(brokerSpec(sourceStencil, sourceRole ?? "none", meta.planning))}
            hint={t("broker.groupHint")}
          >
            <input
              className="insp-input mono"
              value={typeof props.group === "string" ? props.group : ""}
              placeholder={edge.id}
              onChange={(e) => editor.setEdgeProps(edge.id, { group: e.target.value || undefined }, merge("group"))}
              name="consumer-group"
              data-testid="inspector-field-group"
            />
          </Field>
        )}
        {flow && !fields.group && typeof props.group === "string" && (
          <InertNote
            name="group"
            text={t("inspector.inertGroup", { group: String(props.group) })}
            onRemove={() => editor.setEdgeProps(edge.id, { group: undefined })}
          />
        )}
        {deadLetters && (
          <label className="insp-check">
            <input
              type="checkbox"
              checked={props.dlq === true}
              onChange={(e) => editor.setEdgeProps(edge.id, { dlq: e.target.checked || undefined })}
              name="dlq"
              data-testid="inspector-field-dlq"
            />
            <span>
              {t("inspector.deadLetterPath")}
              <small>{t("inspector.failedMessagesFromTheSourceBrokerGoHere")}</small>
            </span>
          </label>
        )}
        {flow && !deadLetters && props.dlq === true && (
          <InertNote
            name="dlq"
            text={
              sourceRole === "processor"
                ? t("inspector.deadLetterPathIsOnButOnlyABroker")
                : t("inspector.deadLetterPathIsOnButOnlyABroker2")
            }
            onRemove={() => editor.setEdgeProps(edge.id, { dlq: undefined })}
          />
        )}
        {!flow && (
          <p className="insp-note" data-testid="inspector-relation-note">
            {relationNote(relation)}
          </p>
        )}
      </Section>
      <EdgeLiveDetails key={edge.id} id={edge.id} />
      {relation === "config" && <SettingsEditor key={edge.id} edge={edge} editor={editor} />}
      {(fanOut || requestWait || (flow && revisionAtLeast(meta.planning?.revision, "p3-w2"))) && (
        <Disclosure id="edge-simulation" title={t("inspector.simulation")} summary={callSummary}>
          {requestWait && (
            <CallWaitFields
              editor={editor}
              edgeId={edge.id}
              caller={props.caller}
              stencil={sourceStencil ?? ""}
              readDiagram={readDiagram}
            />
          )}
          {flow && revisionAtLeast(meta.planning?.revision, "p3-w2") && (
            <EdgePriorityField editor={editor} edgeId={edge.id} />
          )}
          {fanOut && (
            <SimInput
              name="share"
              field={{
                label: t("inspector.shareOfMessages"),
                unit: "%",
                kind: "number",
                min: 0,
                max: 100,
                step: 5,
                placeholder: "100",
                hint: t("inspector.howManyOfTheMessagesLeavingThisNodeAlso"),
              }}
              value={typeof props.share === "number" ? Math.round(props.share * 1000) / 10 : undefined}
              onChange={(v) =>
                editor.setEdgeProps(edge.id, { share: typeof v === "number" ? v / 100 : undefined }, merge("share"))
              }
            />
          )}
        </Disclosure>
      )}
      {flow && (
        <Disclosure id="edge-messages" title={t("messageTypes.messages")}>
          <MessageFields readDiagram={readDiagram} edgeId={edge.id} editor={editor} />
        </Disclosure>
      )}
      {flow && routingEnabled(meta.planning) && (routeCaller || source?.props?.routeTable) && (
        <Section>
          <EdgeRouteFields editor={editor} edgeId={edge.id} planning={meta.planning} caller={routeCaller} />
        </Section>
      )}
      <EdgeAdvanced edge={edge} editor={editor} data={data} props={props} flow={flow} rule={rule} merge={merge} />
    </>
  );
}

/** Flow edges into a typed stencil (Key Vault, an IdP...): offer the dependency they look like. */
const dismissedHints = new Set<string>();

export function RelationHint({ edge, editor }: { edge: DiagramFlowEdge; editor: EditorApi }) {
  const [, rerender] = useState(0);
  if (isDependency(edge.data) || dismissedHints.has(edge.id)) return null;
  const want = inferRelation(editor.getNode(edge.source)?.stencil, editor.getNode(edge.target)?.stencil);
  if (want === "flow") return null;
  return (
    <div className="insp-hint" data-testid="inspector-relation-hint">
      <Icon name={relationIcon(want)} size={13} />
      <span>{t("inspector.suggestRelation", { relation: relationLabel[want].toLocaleLowerCase() })}</span>
      <button
        type="button"
        className="insp-link"
        onClick={() => editor.updateEdge(edge.id, { relation: want })}
        data-testid="inspector-relation-hint-apply"
      >
        {t("inspector.apply")}
      </button>
      <button
        type="button"
        className="icon-btn insp-mini"
        title={t("inspector.keepItAFlow")}
        aria-label={t("inspector.keepItAFlow")}
        onClick={() => {
          dismissedHints.add(edge.id);
          rerender((n) => n + 1);
        }}
        data-testid="inspector-relation-hint-dismiss"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
