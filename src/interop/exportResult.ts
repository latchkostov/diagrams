/** A completed writer, a refusal, or cancellation; opening a dialog is not an export. */
export type ExportResult = { status: "success" | "failure" | "cancelled" };
