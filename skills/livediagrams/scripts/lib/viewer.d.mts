export function assembleViewer(read: (file: string) => Buffer): string;
export function readViewer(lib?: URL): string;
export function readIcons(lib?: URL): Record<string, string>;
