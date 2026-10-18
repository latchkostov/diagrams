export const customCount = (props: Record<string, unknown>, hidden: Set<string>) =>
  Object.keys(props).filter((k) => !hidden.has(k)).length;
