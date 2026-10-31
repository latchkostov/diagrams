/** An import only succeeds once its destination accepts the replacement. */
export type ImportResult = { status: "success" | "failure" | "cancelled" };
