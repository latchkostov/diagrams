import { TypePicker } from "../../components/MessageTypePicker";
import { t } from "../../i18n";
import { messageTypesAt } from "../../model/messageTypes";
import type { DiagramFile } from "../../model/types";
import type { EditorApi } from "../../editor/types";
import { Field } from "./fields";
import { bulkStep } from "./editTransactions";

export function EdgeMessages({
  readDiagram,
  edgeId,
  editor,
}: {
  readDiagram?: () => DiagramFile;
  edgeId: string;
  editor: EditorApi;
}) {
  const diagram = readDiagram?.() ?? editor.getDiagram();
  const types = messageTypesAt(diagram);
  const props = diagram.edges.find((edge) => edge.id === edgeId)?.props ?? {};
  const filter = Array.isArray(props.filter) ? props.filter.filter((v): v is string => typeof v === "string") : [];
  const carries = [...(types.carried.get(edgeId) ?? [])];
  return (
    <div className="message-fields" data-testid="inspector-messages">
      <h4>{t("messageTypes.messages")}</h4>
      <Field label={t("messageTypes.carries")} group>
        <div className="message-type-chips" aria-live="polite" data-testid="inspector-carries">
          {carries.length ? (
            carries.map((type) => (
              <span className="message-type-chip" key={type}>
                {type}
              </span>
            ))
          ) : (
            <small className="insp-note">{t("messageTypes.noMessages")}</small>
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

export function NodeMessages({
  readDiagram,
  nodeId,
  editor,
  source,
}: {
  readDiagram?: () => DiagramFile;
  nodeId: string;
  editor: EditorApi;
  source: boolean;
}) {
  const diagram = readDiagram?.() ?? editor.getDiagram();
  const types = messageTypesAt(diagram);
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
  const arriving = [...(types.arriving.get(nodeId) ?? [])];
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
      {rows.map(([input, output], i) => (
        <div className="message-type-rule" key={i} data-testid={`inspector-emits-row-${i}`}>
          <TypePicker
            name={`receives-${i}`}
            wildcard
            label={t("messageTypes.whenReceives")}
            choices={["*", ...arriving].filter((type) => type === input || !rows.some(([key]) => key === type))}
            value={[input]}
            onChange={(value) => {
              if (value[0] && !rows.some(([key], j) => j !== i && key === value[0]))
                save(rows.map((row, j) => (j === i ? [value[0], output] : row)));
            }}
          />
          <TypePicker
            name={`sends-${i}`}
            label={t("messageTypes.thenSends")}
            choices={[...new Set([...arriving, ...types.known])]}
            value={[output]}
            onChange={(value) =>
              save(
                value.length
                  ? rows.map((row, j) => (j === i ? [input, value[0]] : row))
                  : rows.filter((_, j) => i !== j),
              )
            }
          />
          <button
            type="button"
            className="insp-link"
            aria-label={t("messageTypes.removeRule")}
            data-testid={`inspector-emits-remove-${i}`}
            onClick={() => save(rows.filter((_, j) => i !== j))}
          >
            {t("messageTypes.remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="insp-link"
        data-testid="inspector-emits-add"
        disabled={rows.some(([key]) => key === "*") && arriving.every((type) => rows.some(([key]) => key === type))}
        onClick={() => {
          const input = arriving.find((type) => !rows.some(([key]) => key === type)) ?? "*";
          save([...rows, [input, input === "*" ? (arriving[0] ?? "Message") : input]]);
        }}
      >
        {t("messageTypes.addRule")}
      </button>
    </div>
  );
}
