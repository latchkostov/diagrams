export function planShards(total: number, root?: string): { files: string[]; seconds: number }[];
export function shardFiles(current: number, total: number, root?: string): string[];
export function updateTimings(reports: string[], root?: string): void;
