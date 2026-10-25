import { useContext, type ComponentProps } from "react";
import { SimErrors } from "./validationContext";

function useError(field: string) {
  const error = useContext(SimErrors).has(field);
  return { "aria-invalid": error || undefined, "aria-describedby": error ? `${field}-error` : undefined } as const;
}
export function ValidationInput(props: ComponentProps<"input"> & { "data-testid": string }) {
  return <input {...props} {...useError(props["data-testid"])} />;
}
export function ValidationSelect(props: ComponentProps<"select"> & { "data-testid": string }) {
  return <select {...props} {...useError(props["data-testid"])} />;
}
