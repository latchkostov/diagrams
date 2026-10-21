/** Closing is tentative: pending reads remain current if the bridge rejects the close. */
export class ConfigurationLifecycle {
  closed = false;
  closing = false;
  generation = 0;

  async close(request: () => Promise<void>): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    try {
      await request();
      this.closed = true;
      this.generation++;
    } finally {
      this.closing = false;
    }
  }
}

/** Persistence belongs to the accepted file, independently of subsequent read attempts. */
export class AcceptedSelection {
  attachmentId?: string;
  constructor(readonly file: File) {}
}
