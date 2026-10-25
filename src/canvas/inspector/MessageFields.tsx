import { MAX_CHOICES, TypePicker } from "../../components/MessageTypePicker";
import { t } from "../../i18n";
import { useMessageTypes } from "./useMessageTypes";
import { useLayoutEffect, useRef, useState } from "react";
import type { DiagramFile } from "../../model/types";
import type { EditorApi } from "../../editor/types";
import { Field } from "./fields";
import { Subgroup } from "./Layout";
import { useInteractionOrLocal } from "../interaction";
import { bulkStep } from "./editTransactions";

export function EdgeMessages({
  readDiagram,
  edgeId,
  editor,
  paused,
}: {
  readDiagram?: () => DiagramFile;
  edgeId: string;
  editor: EditorApi;
  paused?: boolean;
}) {
  const diagram = readDiagram?.() ?? editor.getDiagram();
  const { types, updating } = useMessageTypes(diagram, paused);
  const [search, setSearch] = useState("");
  if (!types)
    return (
      <p className="insp-note" role="status">
        {t("common.loading")}
      </p>
    );
  const props = diagram.edges.find((edge) => edge.id === edgeId)?.props ?? {};
  const filter = Array.isArray(props.filter) ? props.filter.filter((v): v is string => typeof v === "string") : [];
  const carries = [...(types.carried.get(edgeId) ?? [])];
  const matching =
    carries.length > MAX_CHOICES && search
      ? carries.filter((type) => type.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      : carries;
  return (
    <div className="message-fields" data-testid="inspector-messages">
      <h4>{t("messageTypes.messages")}</h4>
      <Field label={t("messageTypes.carries")} group>
        {carries.length > MAX_CHOICES && (
          <input
            className="insp-input"
            aria-label={t("messageTypes.search")}
            placeholder={t("messageTypes.search")}
            data-testid="inspector-carries-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        <div className="message-type-chips" aria-live="polite" data-testid="inspector-carries">
          {matching.length ? (
            matching.slice(0, MAX_CHOICES).map((type) => (
              <span className="message-type-chip" key={type} data-testid="inspector-carries-type">
                {type}
              </span>
            ))
          ) : (
            <small className="insp-note">{t("messageTypes.noMessages")}</small>
          )}
          {matching.length > MAX_CHOICES && (
            <small className="insp-note" data-testid="inspector-carries-more">
              +{t("importReport.more", { count: matching.length - MAX_CHOICES })}
            </small>
          )}
        </div>
      </Field>
      {!types.complete && (
        <p className="insp-note" role="status">
          {t("messageTypes.incomplete")}
        </p>
      )}
      <TypePicker
        name="filter"
        label={t("messageTypes.onlyPass")}
        multiple
        updating={updating}
        choices={[...(types.upstream.get(edgeId) ?? [])]}
        value={filter}
        hint={t("messageTypes.filterHint")}
        onChange={(value) =>
          editor.setEdgeProps(edgeId, { filter: value.length ? value : undefined }, bulkStep("message-filter"))
        }
      />
      {Array.isArray(props.filter) && !props.filter.length && (
        <button
          type="button"
          className="insp-link"
          data-testid="inspector-filter-clear"
          onClick={() => editor.setEdgeProps(edgeId, { filter: undefined }, bulkStep("message-filter"))}
        >
          {t("messageTypes.passAll")}
        </button>
      )}
      <TypePicker
        name="emits"
        label={t("messageTypes.sendAs")}
        choices={[...types.known].sort()}
        value={typeof props.emits === "string" ? [props.emits] : []}
        hint={t("messageTypes.renameHint")}
        onChange={(value) => editor.setEdgeProps(edgeId, { emits: value[0] }, bulkStep("message-rename"))}
      />
    </div>
  );
}

const RULE_PAGE = 25;

export function NodeMessages({
  readDiagram,
  nodeId,
  editor,
  source,
  paused,
}: {
  readDiagram?: () => DiagramFile;
  nodeId: string;
  editor: EditorApi;
  source: boolean;
  paused?: boolean;
}) {
  const { controller } = useInteractionOrLocal();
  const addButton = useRef<HTMLButtonElement>(null);
  const ruleControls = useRef(new Map<string, HTMLDivElement>());
  // Rows are keyed by their incoming type, so a removed rule's drafts go with it. Changing that type therefore
  // mounts a new row: once it is committed, focus continues at its "When it receives" control (policy row I5).
  const rekeyed = useRef<string | undefined>(undefined);
  // Imported maps can hold thousands of rules: render a page at a time.
  const [shownRules, setShownRules] = useState(RULE_PAGE);
  // A rule added here renders after the current page (the page itself never grows to reach it).
  // Incoming types are editable identity. Retain the appended row's names across rekey Undo, newest first.
  const [added, setAdded] = useState<string[]>([]);
  useLayoutEffect(() => {
    const input = rekeyed.current;
    const target = input === undefined ? null : ruleControls.current.get(input)?.querySelector("button");
    if (!target) return;
    rekeyed.current = undefined;
    controller.dispatch({ type: "inspector.rule", target });
  });
  // Declared after the effect above, so a move it requests runs in this same commit.
  useLayoutEffect(() => controller.rendered());
  const diagram = readDiagram?.() ?? editor.getDiagram();
  const { types } = useMessageTypes(diagram, paused);
  if (!types)
    return (
      <p className="insp-note" role="status">
        {t("common.loading")}
      </p>
    );
  const node = diagram.nodes.find((n) => n.id === nodeId)!;
  const emits = node.props?.emits;
  const rows: [string, string][] =
    typeof emits === "string"
      ? [["*", emits]]
      : emits && typeof emits === "object" && !Array.isArray(emits)
        ? Object.entries(emits).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        : [];
  const save = (next: [string, string][]) =>
    editor.setNodeProps(
      nodeId,
      {
        emits:
          next.length === 1 && next[0][0] === "*" ? next[0][1] : next.length ? Object.fromEntries(next) : undefined,
      },
      bulkStep("message-emits"),
    );
  const remove = (input: string) => {
    const next = rows.filter(([key]) => key !== input);
    save(next);
    const neighbor =
      next[
        Math.min(
          rows.findIndex(([key]) => key === input),
          next.length - 1,
        )
      ];
    const target = neighbor && ruleControls.current.get(neighbor[0])?.querySelector<HTMLButtonElement>("button");
    const destination = target || addButton.current;
    if (destination) controller.dispatch({ type: "inspector.rule", target: destination });
  };
  const arriving = [...(types.arriving.get(nodeId) ?? [])];
  // Shared by every row, built once per render: rows never rescan each other.
  const assigned = new Set(rows.map(([key]) => key));
  const incoming = ["*", ...arriving];
  const unassigned = incoming.filter((type) => !assigned.has(type));
  const vocabulary = [...new Set([...arriving, ...types.known])];
  const page = Math.min(shownRules, rows.length);
  const addedInput = added.find((type) => assigned.has(type));
  const addedAt = addedInput === undefined ? -1 : rows.findIndex(([key]) => key === addedInput);
  const visible = [...Array(page).keys(), ...(addedAt >= page ? [addedAt] : [])];
  const remaining = rows.length - visible.length;
  // Message is the simulation default type, diagram data rather than translated UI copy.
  const defaultType = node.label || "Message";
  if (source)
    return (
      <TypePicker
        name="messageType"
        label={t("messageTypes.sends")}
        choices={[...types.known].sort()}
        value={typeof node.props?.messageType === "string" ? [node.props.messageType] : []}
        placeholder={defaultType}
        onChange={(value) => editor.setNodeProps(nodeId, { messageType: value[0] }, bulkStep("message-source"))}
      />
    );
  return (
    <div className="message-fields" data-testid="inspector-emits-rows">
      <h4>{t("inspector.emits")}</h4>
      <p className="insp-note">{t("messageTypes.emitsHint")}</p>
      {visible.map((i) => {
        const [input, output] = rows[i];
        return (
          <Subgroup
            key={input}
            ref={(element) => {
              if (element) ruleControls.current.set(input, element);
              else ruleControls.current.delete(input);
            }}
            testId={`inspector-emits-row-${i}`}
          >
            <TypePicker
              name={`receives-${i}`}
              wildcard
              label={t("messageTypes.whenReceives")}
              choices={incoming.filter((type) => type === input || !assigned.has(type))}
              value={[input]}
              onChange={(value) => {
                if (!value[0] || assigned.has(value[0])) return;
                rekeyed.current = value[0];
                if (i === addedAt) setAdded([value[0], ...added.filter((type) => type !== value[0])]);
                save(rows.map((row, j) => (j === i ? [value[0], output] : row)));
              }}
            />
            <TypePicker
              name={`sends-${i}`}
              label={t("messageTypes.thenSends")}
              choices={vocabulary}
              value={[output]}
              onChange={(value) => {
                if (value.length) save(rows.map((row, j) => (j === i ? [input, value[0]] : row)));
                else remove(input);
              }}
            />
            <button
              type="button"
              className="insp-link"
              aria-label={t("messageTypes.removeRule")}
              data-testid={`inspector-emits-remove-${i}`}
              onClick={() => remove(input)}
            >
              {t("messageTypes.remove")}
            </button>
          </Subgroup>
        );
      })}
      {remaining > 0 && (
        <button
          type="button"
          className="insp-link"
          data-testid="inspector-emits-more"
          onClick={() => {
            // The button may unmount: continue at the first rule it reveals (policy row I5).
            rekeyed.current = rows[page][0];
            setShownRules(page + RULE_PAGE);
          }}
        >
          +{t("importReport.more", { count: Math.min(RULE_PAGE, remaining) })}
        </button>
      )}
      <button
        type="button"
        className="insp-link"
        ref={addButton}
        data-testid="inspector-emits-add"
        disabled={!unassigned.length}
        onClick={() => {
          const input = arriving.find((type) => !assigned.has(type)) ?? "*";
          // The Add button may disable itself: continue at the new rule once it is committed (policy row I5).
          rekeyed.current = input;
          setAdded([input]);
          save([...rows, [input, input === "*" ? (arriving[0] ?? "Message") : input]]);
        }}
      >
        {t("messageTypes.addRule")}
      </button>
    </div>
  );
}

/** One lazy entry for both inspector panels: a connection's messages, or a node's. */
export function MessageFields(
  props: Parameters<typeof EdgeMessages>[0] | (Parameters<typeof NodeMessages>[0] & { edgeId?: undefined }),
) {
  return props.edgeId === undefined ? <NodeMessages {...props} /> : <EdgeMessages {...props} />;
}

/** The edge hover reader shares this chunk: message-type UI loads once, on intent. */
export { MessageTip } from "../edges/carriedTypes";
