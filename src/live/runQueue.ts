/** A document-scoped launch owns one Live activation, independently of host publications. */
export interface RunRequest {
  documentId: string | undefined;
  simulationId: string;
}

export function createRunQueue() {
  let pending: RunRequest | null = null;
  let activated = false;
  return {
    get pending() {
      return pending;
    },
    request(request: RunRequest) {
      pending = request;
      activated = false;
    },
    cancel() {
      pending = null;
    },
    consume(documentId: string | undefined) {
      if (!pending || pending.documentId !== documentId) return null;
      const request = pending;
      pending = null;
      return request;
    },
    activate(documentId: string | undefined, goLive: () => void) {
      if (!pending || pending.documentId !== documentId || activated) return;
      activated = true;
      goLive();
    },
  };
}
