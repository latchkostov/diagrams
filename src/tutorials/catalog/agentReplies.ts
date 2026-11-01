/* eslint-disable local/no-literal-ui-text -- These are authored public fixture diagram labels, not interface copy. */
/** Invented public data, supplied locally. Never sent to a model. Labels are authored fixture bytes. */
export const workerReply = JSON.stringify({
  layout: "none",
  ops: [
    { op: "add_node", kind: "service.go", label: "Status worker", key: "worker" },
    { op: "connect", from: "api", to: "worker", kind: "async" },
  ],
});
export const renameReply = JSON.stringify({
  layout: "none",
  ops: [{ op: "update", target: "Status worker", label: "Unreviewed worker" }],
});
