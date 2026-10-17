export function pnpmCommand(args: string[], entry?: string): [string, string[]];
export interface CommandResult {
  code: number;
  text: string;
  stdout: string;
  stderr: string;
}
export function command(bin: string, args: string[], options?: Record<string, unknown>): Promise<CommandResult>;
export function git(
  args: string[],
  cwd: string,
  execute?: (bin: string, args: string[], options?: Record<string, unknown>) => Promise<CommandResult>,
): Promise<string>;
