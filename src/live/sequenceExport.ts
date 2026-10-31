import { createFileWriter } from "../interop/files";
import { observationPorts } from "../lib/observations";

export type SequenceExportResult =
  { status: "success"; bytes: number } | { status: "failure" } | { status: "cancelled" };
/** One dialog's export operations. A newer click, close, Restart or Exit invalidates late completion. */
export function createSequenceExporter(traceId: number) {
  let disposed = false;
  let active: AbortController | undefined;
  return {
    cancel() {
      disposed = true;
      active?.abort();
    },
    async run(
      format: "svg" | "mermaid" | "png",
      write: (writer: ReturnType<typeof createFileWriter>, check: () => void) => Promise<number>,
    ): Promise<SequenceExportResult> {
      if (disposed) return { status: "cancelled" };
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const writer = createFileWriter();
      const check = () => {
        controller.signal.throwIfAborted();
        writer.check();
      };
      try {
        const bytes = await write(writer, check);
        check();
        if (writer.source) observationPorts.sequenceExport.publish({ ...writer.source, traceId, format, bytes });
        return { status: "success", bytes };
      } catch {
        return controller.signal.aborted || writer.signal.aborted ? { status: "cancelled" } : { status: "failure" };
      } finally {
        writer.finish();
      }
    },
  };
}
