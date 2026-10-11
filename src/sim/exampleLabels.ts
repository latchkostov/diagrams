/** Local validation must use anonymous labels even if callers pass a confidential path. */
export function exampleTestLabel(path: string, index: number): string {
  return path.replaceAll("\\", "/").includes("/private/") ? `local example #${index + 1}` : path;
}
