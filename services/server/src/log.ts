// Deliberately no arbitrary object/error/reason input: untrusted bytes and identifiers never reach stdout.
export type LogEvent = "listening" | "joined" | "closed" | "refused" | "socket-error";
export function createLog(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)) {
  return (event: LogEvent, code?: number, ip?: string): void => {
    write(JSON.stringify({ event, ...(code === undefined ? {} : { code }), ...(ip === undefined ? {} : { ip }) }));
  };
}
export type Logger = ReturnType<typeof createLog>;
